-- Squads top-up proposals drafted by the top-up worker. The worker's key can only propose;
-- signers approve and execute in the Squads app. One open proposal at a time.
CREATE TABLE topup_proposals (
  id                bigserial PRIMARY KEY,
  multisig          text NOT NULL,
  transaction_index bigint NOT NULL,
  -- creating: rows written before the chain calls; active: waiting on signers;
  -- abandoned: creation never finished (a draft nobody can approve, or nothing on chain).
  status            text NOT NULL DEFAULT 'creating'
                    CHECK (status IN ('creating', 'active', 'executed', 'rejected', 'cancelled', 'stale', 'abandoned')),
  sol_lamports      bigint NOT NULL DEFAULT 0 CHECK (sol_lamports >= 0),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- An abandoned row never reached the chain (or never went live), so its index can be reused.
CREATE UNIQUE INDEX topup_proposals_index_live ON topup_proposals (multisig, transaction_index) WHERE status <> 'abandoned';
CREATE UNIQUE INDEX topup_proposals_one_open ON topup_proposals ((true)) WHERE status IN ('creating', 'active');

CREATE TABLE topup_proposal_items (
  proposal_id       bigint NOT NULL REFERENCES topup_proposals(id),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  nft_mint          text NOT NULL,
  PRIMARY KEY (proposal_id, inventory_item_id)
);
CREATE INDEX topup_proposal_items_item_idx ON topup_proposal_items(inventory_item_id);
