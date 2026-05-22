import { loginWithGomo6 } from "@/lib/oauth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, ExternalLink } from "lucide-react";

const Login = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <KeyRound className="w-8 h-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-xl">gomo6 Dev Dashboard</CardTitle>
          <CardDescription className="mt-2">
            Войдите через свою учётную запись gomo6 для управления
            OAuth-приложениями и интеграциями
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={loginWithGomo6}
            className="w-full h-12 text-base gap-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 shadow-lg shadow-emerald-500/25 transition-all duration-200 hover:shadow-emerald-500/40"
          >
            <ExternalLink className="w-5 h-5" />
            Войти через gomo6
          </Button>
          <p className="text-xs text-center text-muted-foreground mt-4">
            Вы будете перенаправлены на страницу авторизации gomo6,
            где сможете подтвердить вход
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
