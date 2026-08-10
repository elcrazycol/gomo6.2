import { Link } from "react-router-dom";
import { Shield, Smile } from "lucide-react";
import { useModeratorGate } from "@/hooks/useModeratorGate";

const Moderation = () => {
  const { isModerator } = useModeratorGate();

  if (!isModerator) return null;

  return (
    <div className="bg-background min-h-screen">
      <main className="max-w-4xl mx-auto p-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Модерация</h1>
          <p className="text-muted-foreground">Центр управления контентом</p>
                          </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {/* Модерация постов */}
          <Link to="/moderation/posts" className="group">
            <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-8 hover:bg-card/90 transition-all duration-300 hover:scale-105 hover:shadow-xl group-hover:border-primary/30">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="p-4 bg-primary/10 rounded-full group-hover:bg-primary/20 transition-colors">
                  <Shield className="h-8 w-8 text-primary" />
                      </div>
                <h3 className="text-xl font-semibold">Модерация</h3>
                <p className="text-sm text-muted-foreground">
                  Управление жалобами, банами и контентом пользователей
                </p>
                      </div>
                    </div>
          </Link>

          {/* Эмодзи */}
          <Link to="/moderation/emojis" className="group">
            <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-8 hover:bg-card/90 transition-all duration-300 hover:scale-105 hover:shadow-xl group-hover:border-primary/30">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="p-4 bg-primary/10 rounded-full group-hover:bg-primary/20 transition-colors">
                  <Smile className="h-8 w-8 text-primary" />
                                    </div>
                <h3 className="text-xl font-semibold">Эмодзи</h3>
                <p className="text-sm text-muted-foreground">
                  Создание и управление эмодзи для пользователей
                </p>
                        </div>
                      </div>
          </Link>
                </div>
      </main>
    </div>
  );
};

export default Moderation;