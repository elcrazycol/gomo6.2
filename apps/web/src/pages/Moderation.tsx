import { Link } from "react-router-dom";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModeratorGate } from "@/hooks/useModeratorGate";

const Moderation = () => {
  const { isModerator } = useModeratorGate();

  if (!isModerator) return null;

  return (
    <div className="bg-background min-h-screen">
      <main className="mx-auto max-w-md p-4 pt-10 text-center">
        <h1 className="text-2xl font-bold mb-6">Модерация</h1>
        <Link to="/moderation/posts" className="inline-block">
          <Button size="lg" className="gap-2">
            <Flag className="h-4 w-4" />
            Жалобы
          </Button>
        </Link>
      </main>
    </div>
  );
};

export default Moderation;