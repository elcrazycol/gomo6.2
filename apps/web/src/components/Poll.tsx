import { useState, useEffect, useCallback } from "react";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Circle } from "lucide-react";
import { toast } from "sonner";

interface PollOption {
  id: string;
  text: string;
  votes?: number;
  percentage?: number;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  allow_multiple: boolean;
  show_results: boolean;
  allow_change_vote: boolean;
  user_votes?: string[]; // IDs of options user voted for
  total_votes?: number;
}

interface PollProps {
  poll: Poll;
  threadId: string;
  currentUserId: string | null;
  isPageLoading?: boolean;
}

export const Poll = ({ poll, threadId, currentUserId, isPageLoading = false }: PollProps) => {
  const [userVotes, setUserVotes] = useState<string[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, { votes: number; total_votes: number }>>({});

  // Load user votes
  const loadUserVotes = useCallback(async () => {
    if (!currentUserId) return;

    try {
      const { data: userVote, error } = await api
        .from('poll_votes')
        .select('option_ids')
        .eq('poll_id', poll.id)
        .eq('user_id', currentUserId)
        .maybeSingle();

      if (error) throw error;

      const votes = userVote?.option_ids || [];
      setUserVotes(votes);
      setHasVoted(votes.length > 0);
    } catch (error) {
      console.error('Error loading user votes:', error);
    }
  }, [currentUserId, poll.id]);

  // Load poll results
  const loadResults = useCallback(async () => {
    try {
      const { data, error } = await api.rpc('get_poll_results', { poll_uuid: poll.id });
      if (error) throw error;

      const resultsMap: Record<string, { votes: number; total_votes: number }> = {};
type PollResultRow = { option_id: string; votes: number; total_votes: number };
      (data as PollResultRow[])?.forEach((row) => {
        resultsMap[row.option_id] = {
          votes: Number(row.votes),
          total_votes: Number(row.total_votes)
        };
      });
      setResults(resultsMap);
    } catch (error) {
      console.error('Error loading poll results:', error);
    }
  }, [poll.id]);

  // Load user votes and results on mount
  useEffect(() => {
    loadUserVotes();
    if (poll.show_results) {
      loadResults();
    }
  }, [poll.id, currentUserId, poll.show_results, loadUserVotes, loadResults]);

  // Load results when user has voted or when results become public
  useEffect(() => {
    if (hasVoted && poll.show_results) {
      loadResults();
    }
  }, [hasVoted, poll.show_results, loadResults]);

  const handleVote = async (optionId: string) => {
    if (!currentUserId) {
      toast.error("Необходимо войти в систему для голосования");
      return;
    }

    if (hasVoted && !poll.allow_change_vote) {
      toast.error("Вы уже проголосовали и изменение голоса запрещено");
      return;
    }

    // Additional validation
    if (!optionId || optionId === undefined || optionId === null) {
      toast.error("Ошибка: некорректный идентификатор опции");
      return;
    }

    setLoading(true);
    try {

      if (poll.allow_multiple) {
        // Multiple choice logic
        const newVotes = userVotes.includes(optionId)
          ? userVotes.filter(id => id !== optionId) // Remove vote
          : [...userVotes, optionId]; // Add vote

        if (newVotes.length === 0 && hasVoted) {
          // Remove all votes
          const { error } = await api
            .from('poll_votes')
            .delete()
            .eq('poll_id', poll.id)
            .eq('user_id', currentUserId);

          if (error) throw error;

          setUserVotes([]);
          setHasVoted(false);
        } else {
          // First try to update existing vote
          const { data: existingVote } = await api
            .from('poll_votes')
            .select('id')
            .eq('poll_id', poll.id)
            .eq('user_id', currentUserId)
            .maybeSingle();

          // Ensure newVotes is a clean array without null/undefined values
          const cleanVotes = newVotes.filter(vote => vote && vote.trim());

          if (existingVote) {
            // Update existing vote
            const { error } = await api
              .from('poll_votes')
              .update({ option_ids: cleanVotes })
              .eq('id', existingVote.id);

            if (error) throw error;
          } else {
            // Insert new vote
            const { error } = await api
              .from('poll_votes')
              .insert({
                poll_id: poll.id,
                user_id: currentUserId,
                option_ids: cleanVotes
              });

            if (error) throw error;
          }

          setUserVotes(newVotes);
          setHasVoted(newVotes.length > 0);
        }
      } else {
        // Single choice logic
        if (userVotes.includes(optionId)) {
          // Remove vote
          const { error } = await api
            .from('poll_votes')
            .delete()
            .eq('poll_id', poll.id)
            .eq('user_id', currentUserId);

          if (error) throw error;

          setUserVotes([]);
          setHasVoted(false);
        } else {
          // First try to update existing vote
          const { data: existingVote } = await api
            .from('poll_votes')
            .select('id')
            .eq('poll_id', poll.id)
            .eq('user_id', currentUserId)
            .maybeSingle();

          // Ensure optionId is valid
          if (!optionId || !optionId.trim()) {
            throw new Error('Invalid option ID');
          }


          if (existingVote) {
            // Update existing vote
            const { error } = await api
              .from('poll_votes')
              .update({ option_ids: [optionId.trim()] })
              .eq('id', existingVote.id);

            if (error) throw error;
          } else {
            // Insert new vote
            const { error } = await api
              .from('poll_votes')
              .insert({
                poll_id: poll.id,
                user_id: currentUserId,
                option_ids: [optionId.trim()]
              });

            if (error) throw error;
          }

          setUserVotes([optionId]);
          setHasVoted(true);
        }
      }

      // Reload results after voting
      await loadResults();

      toast.success("Голос учтен!");
    } catch (error) {
      console.error('Error voting:', error);
      toast.error("Ошибка при голосовании");
    } finally {
      setLoading(false);
    }
  };

  const getVotePercentage = (optionId: string) => {
    const result = results[optionId];
    if (!result || result.total_votes === 0) return 0;
    return Math.round((result.votes / result.total_votes) * 100);
  };

  const getTotalVotes = () => {
    const firstResult = Object.values(results)[0];
    return firstResult ? firstResult.total_votes : 0;
  };

  return (
    <Card className={`mt-4 ${isPageLoading ? 'opacity-0 pointer-events-none' : ''}`}>
      <CardHeader className={isPageLoading ? 'opacity-0' : ''}>
        <CardTitle className="text-lg">📊 {poll.question}</CardTitle>
        <div className="text-sm text-muted-foreground">
          {poll.allow_multiple ? 'Можно выбрать несколько вариантов' : 'Можно выбрать 1 вариант'}
          {poll.show_results && ` • Всего голосов: ${getTotalVotes()}`}
        </div>
      </CardHeader>
      <CardContent className={`space-y-2 ${isPageLoading ? 'opacity-0 pointer-events-none' : ''}`}>
        {poll.options.map((option) => {
          const isSelected = userVotes.includes(option.id);
          const percentage = getVotePercentage(option.id);
          const optionResult = results[option.id];
          const showResults = poll.show_results || hasVoted;

          return (
            <div key={option.id} className="relative">
              {showResults && optionResult && (
                <div
                  className="absolute inset-0 bg-primary/20 rounded transition-all duration-300"
                  style={{ width: `${percentage}%` }}
                />
              )}

              <Button
                variant={isSelected ? "default" : "outline"}
                className={`w-full justify-start text-left relative z-10 ${
                  showResults ? 'hover:bg-background/80' : ''
                }`}
                onClick={() => handleVote(option.id)}
                disabled={loading}
              >
                <div className="flex items-center gap-2 w-full">
                  {isSelected ? (
                    <CheckCircle className="h-4 w-4 flex-shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 flex-shrink-0" />
                  )}
                  <span className="flex-1">{option.text}</span>
                  {showResults && optionResult && (
                    <span className="text-sm text-muted-foreground ml-2">
                      {optionResult.votes} ({percentage}%)
                    </span>
                  )}
                </div>
              </Button>
            </div>
          );
        })}

        {hasVoted && !poll.allow_change_vote && (
          <div className="text-sm text-muted-foreground text-center mt-3">
            Вы уже проголосовали. Изменение голоса запрещено.
          </div>
        )}
      </CardContent>
    </Card>
  );
};