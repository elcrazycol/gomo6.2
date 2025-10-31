import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Report {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  reporter_id: string | null;
  reported_post_id: string | null;
  reported_thread_id: string | null;
  moderator_note: string | null;
}

const Moderation = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [moderatorNote, setModeratorNote] = useState("");

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (isModerator) {
      loadReports();
    }
  }, [isModerator]);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      navigate("/auth");
      return;
    }

    setUser(user);

    // Check if user is moderator or admin
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isMod = roles?.some(r => r.role === 'moderator' || r.role === 'admin');
    
    if (!isMod) {
      toast.error("У вас нет доступа к этой странице");
      navigate("/");
      return;
    }

    setIsModerator(true);
  };

  const loadReports = async () => {
    const { data } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) {
      setReports(data);
    }
  };

  const handleResolve = async (reportId: string, action: 'approve' | 'reject') => {
    const { error } = await supabase
      .from("reports")
      .update({
        status: action === 'approve' ? 'resolved' : 'rejected',
        moderator_id: user.id,
        moderator_note: moderatorNote,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", reportId);

    if (error) {
      toast.error("Ошибка обработки жалобы");
    } else {
      toast.success(action === 'approve' ? "Жалоба принята" : "Жалоба отклонена");
      setSelectedReport(null);
      setModeratorNote("");
      loadReports();
    }
  };

  if (!isModerator) return null;

  const pendingReports = reports.filter(r => r.status === 'pending');
  const resolvedReports = reports.filter(r => r.status !== 'pending');

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-board-header text-board-header-foreground p-3 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/" className="text-xl font-bold hover:underline">
            6gomo
          </Link>
          <h1 className="text-lg font-bold">Панель модератора</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">
              Новые ({pendingReports.length})
            </TabsTrigger>
            <TabsTrigger value="resolved">
              Обработанные ({resolvedReports.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4 mt-4">
            {pendingReports.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Нет новых жалоб
              </p>
            ) : (
              pendingReports.map((report) => (
                <div key={report.id} className="bg-card border border-border p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {new Date(report.created_at).toLocaleString('ru-RU')}
                      </p>
                      <p className="font-bold mt-1">Причина жалобы:</p>
                      <p className="text-sm">{report.reason}</p>
                    </div>
                    <div className="space-x-2">
                      {report.reported_thread_id && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/thread/${report.reported_thread_id}`)}
                        >
                          Открыть тред
                        </Button>
                      )}
                    </div>
                  </div>

                  {selectedReport === report.id ? (
                    <div className="space-y-2 border-t border-border pt-3">
                      <Textarea
                        placeholder="Заметка модератора..."
                        value={moderatorNote}
                        onChange={(e) => setModeratorNote(e.target.value)}
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleResolve(report.id, 'approve')}
                          variant="default"
                        >
                          Принять
                        </Button>
                        <Button
                          onClick={() => handleResolve(report.id, 'reject')}
                          variant="destructive"
                        >
                          Отклонить
                        </Button>
                        <Button
                          onClick={() => {
                            setSelectedReport(null);
                            setModeratorNote("");
                          }}
                          variant="outline"
                        >
                          Отмена
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      onClick={() => setSelectedReport(report.id)}
                      variant="secondary"
                      size="sm"
                    >
                      Обработать
                    </Button>
                  )}
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="resolved" className="space-y-4 mt-4">
            {resolvedReports.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Нет обработанных жалоб
              </p>
            ) : (
              resolvedReports.map((report) => (
                <div key={report.id} className="bg-card border border-border p-4 opacity-70">
                  <p className="text-sm text-muted-foreground">
                    {new Date(report.created_at).toLocaleString('ru-RU')}
                  </p>
                  <p className="font-bold mt-1">Причина: {report.reason}</p>
                  <p className="text-sm text-primary mt-2">
                    Статус: {report.status === 'resolved' ? 'Принята' : 'Отклонена'}
                  </p>
                  {report.moderator_note && (
                    <p className="text-sm mt-1">
                      Заметка: {report.moderator_note}
                    </p>
                  )}
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Moderation;
