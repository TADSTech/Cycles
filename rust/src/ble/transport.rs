//! High-level BLE transport coordinator and CRDT seam contract.
//!
//! Provides the seam for `automerge_core_20260919`:
//! `fn merge_incoming(bytes: Vec<u8>) -> MergeResult`
//!
//! Handles bidirectional chunked frame transmission, pairing verification,
//! and simulated channel verification for testing.

use super::{
    framing::{Chunker, Frame, Reassembler},
    pairing::PeerStore,
    tie_break::decide_role,
};

/// The result of an incoming sync merge operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeResult {
    /// Optional response bytes to send back to the peer (e.g. Automerge sync response or ACK).
    pub response_bytes: Option<Vec<u8>>,
    /// True if merge was applied cleanly.
    pub success: bool,
}

/// Processes incoming bytes from a BLE transfer exchange and returns an ACK response.
pub fn merge_incoming(bytes: Vec<u8>) -> MergeResult {
    let mut ack_response = b"ACK:".to_vec();
    ack_response.extend_from_slice(&bytes);
    MergeResult {
        response_bytes: Some(ack_response),
        success: true,
    }
}

/// Simulated in-memory BLE channel for testing full protocol flow (discovery,
/// tie-breaking, chunking, CRC32, reassembly, bidirectional response).
pub struct SimulatedBleNode {
    pub device_id: String,
    pub peer_store: PeerStore,
    pub reassembler: Reassembler,
}

impl SimulatedBleNode {
    pub fn new(device_id: &str) -> Self {
        Self {
            device_id: device_id.to_string(),
            peer_store: PeerStore::new(),
            reassembler: Reassembler::new(),
        }
    }

    /// Simulates a bidirectional sync exchange between this node and a remote node.
    /// Returns (receiver_received_payload, initiator_received_response).
    pub fn sync_with(
        &mut self,
        remote: &mut SimulatedBleNode,
        outgoing_payload: &[u8],
        chunk_size: usize,
    ) -> Result<(Vec<u8>, Vec<u8>), Box<dyn std::error::Error>> {
        // 1. Tie-break roles
        let local_role = decide_role(&self.device_id, &remote.device_id)?;
        let remote_role = decide_role(&remote.device_id, &self.device_id)?;
        assert_ne!(local_role, remote_role, "Roles must be mutually exclusive");

        // 2. Chunk outgoing payload (Initiator -> Receiver)
        let frames = Chunker::chunk(1, outgoing_payload, chunk_size);

        // 3. Transmit frames to remote reassembler
        let mut receiver_payload = None;
        for frame in frames {
            let wire_bytes = frame.encode();
            let decoded = Frame::decode(&wire_bytes)?;
            if let Some(complete) = remote.reassembler.feed(decoded)? {
                receiver_payload = Some(complete);
            }
        }

        let received = receiver_payload.ok_or("Receiver did not complete payload reassembly")?;

        // 4. Receiver calls merge_incoming
        let merge_res = merge_incoming(received.clone());
        let response_to_send = merge_res
            .response_bytes
            .ok_or("No response bytes from merge")?;

        // 5. Reverse direction: Receiver -> Initiator
        let resp_frames = Chunker::chunk(2, &response_to_send, chunk_size);
        let mut initiator_response = None;
        for frame in resp_frames {
            let wire_bytes = frame.encode();
            let decoded = Frame::decode(&wire_bytes)?;
            if let Some(complete) = self.reassembler.feed(decoded)? {
                initiator_response = Some(complete);
            }
        }

        let final_resp =
            initiator_response.ok_or("Initiator did not complete response reassembly")?;

        Ok((received, final_resp))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_incoming_stub() {
        let input = b"test-crdt-payload".to_vec();
        let result = merge_incoming(input.clone());
        assert!(result.success);
        assert_eq!(result.response_bytes, Some([b"ACK:", &input[..]].concat()));
    }

    #[test]
    fn test_bidirectional_simulated_ble_transport() {
        let mut node_a = SimulatedBleNode::new("device-02-initiator");
        let mut node_b = SimulatedBleNode::new("device-01-receiver");

        // 15 KB payload to force multi-chunking across MTU boundaries
        let payload: Vec<u8> = (0..15_000).map(|i| (i % 256) as u8).collect();
        let chunk_size = 200; // Small MTU chunk size -> ~75 frames

        let (received_by_b, response_received_by_a) = node_a
            .sync_with(&mut node_b, &payload, chunk_size)
            .expect("Simulated BLE sync failed");

        // Verify A -> B integrity
        assert_eq!(received_by_b.len(), 15_000);
        assert_eq!(received_by_b, payload);

        // Verify B -> A reverse direction integrity
        let expected_ack = [b"ACK:", &payload[..]].concat();
        assert_eq!(response_received_by_a.len(), expected_ack.len());
        assert_eq!(response_received_by_a, expected_ack);
    }
}
