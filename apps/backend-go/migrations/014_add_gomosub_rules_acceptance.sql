-- Create gomosub_rules_acceptance table
CREATE TABLE IF NOT EXISTS gomosub_rules_acceptance (
    user_id UUID NOT NULL,
    board_id UUID NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, board_id)
);

-- Add foreign key constraints
ALTER TABLE gomosub_rules_acceptance
    ADD CONSTRAINT fk_gomosub_rules_acceptance_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE gomosub_rules_acceptance 
    ADD CONSTRAINT fk_gomosub_rules_acceptance_board_id 
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_gomosub_rules_acceptance_user_id ON gomosub_rules_acceptance(user_id);
CREATE INDEX IF NOT EXISTS idx_gomosub_rules_acceptance_board_id ON gomosub_rules_acceptance(board_id);
CREATE INDEX IF NOT EXISTS idx_gomosub_rules_acceptance_accepted_at ON gomosub_rules_acceptance(accepted_at);

-- Add trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_gomosub_rules_acceptance_updated_at 
    BEFORE UPDATE ON gomosub_rules_acceptance 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
