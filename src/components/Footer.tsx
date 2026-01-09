import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export const Footer = () => {
  return (
    <footer className="bg-card border-t border-border mt-16">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Logo and description */}
          <div className="space-y-4">
            <h3 className="text-xl font-bold">gomo6</h3>
            <p className="text-sm text-muted-foreground">
              Анонимный форум для свободного общения
            </p>
            <Link to="/rules">
              <Button variant="outline" size="sm">
                Правила
              </Button>
            </Link>
          </div>

          {/* Links */}
          <div className="space-y-4">
            <h4 className="font-semibold">Навигация</h4>
            <div className="space-y-2">
              <Link to="/" className="block text-sm text-muted-foreground hover:text-foreground transition-colors">
                Главная
              </Link>
              <Link to="/rules" className="block text-sm text-muted-foreground hover:text-foreground transition-colors">
                Информация
              </Link>
            </div>
          </div>

          {/* Contact/Support */}
          <div className="space-y-4">
            <h4 className="font-semibold">Поддержка</h4>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Если у вас возникли проблемы или вопросы, обратитесь к администрации.
              </p>
              <p className="text-xs text-muted-foreground">
                © 2024 gomo6. Все права защищены.
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};