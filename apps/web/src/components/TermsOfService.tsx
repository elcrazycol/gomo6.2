import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TermsOfServiceProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
  canDecline?: boolean;
}

export function TermsOfService({ open, onAccept, onDecline, canDecline = true }: TermsOfServiceProps) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Пользовательское соглашение GOMO6</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[50vh] pr-4">
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="font-bold text-base mb-2">1. Общие положения</h3>
              <p>1.1. Сайт gomo6 — имиджборд, где пользователи могут публиковать текст, изображения и другие материалы.</p>
              <p>1.2. Используя сайт, пользователь подтверждает, что ему исполнилось 18 лет.</p>
            </section>

            <section>
              <h3 className="font-bold text-base mb-2">2. Контент</h3>
              <p>2.1. На сайте разрешено всё, что не запрещено законодательством страны, в которой расположен сервер / пользователь.</p>
              <p className="font-bold">2.2. Запрещён контент:</p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>детская порнография, сексуальная эксплуатация несовершеннолетних;</li>
                <li>участие животных в сексуальных действиях;</li>
                <li>пропаганда насилия, терроризма, наркотиков;</li>
                <li>публикация личных данных других людей без согласия;</li>
                <li>угрозы, шантаж, продажа запрещённых веществ/оружия;</li>
                <li>любые другие материалы, нарушающие закон.</li>
              </ul>
            </section>

            <section>
              <h3 className="font-bold text-base mb-2">3. Ответственность</h3>
              <p>3.1. Пользователи несут полную ответственность за публикуемый контент.</p>
              <p>3.2. Администрация не проверяет контент заранее и не несёт ответственность за материалы, размещённые пользователями.</p>
              <p>3.3. Если пользователь нарушает закон или правила, администрация имеет право удалить контент, ограничить доступ или заблокировать аккаунт без предупреждения.</p>
            </section>

            <section>
              <h3 className="font-bold text-base mb-2">4. Права администрации</h3>
              <p>4.1. Администрация может удалять сообщения, блокировать пользователей и передавать информацию правоохранительным органам, если есть основания считать, что был нарушен закон.</p>
              <p>4.2. Администрация вправе временно или навсегда приостанавливать работу сайта без объяснения причин.</p>
            </section>

            <section>
              <h3 className="font-bold text-base mb-2">5. Сбор данных</h3>
              <p>5.1. При регистрации и использовании сайта собираются технические данные: IP-адрес, cookies, время посещений и другие стандартные лог-файлы.</p>
              <p>5.2. Эти данные используются для защиты сайта, статистики и предотвращения нарушений.</p>
            </section>

            <section>
              <h3 className="font-bold text-base mb-2">6. Возрастные ограничения</h3>
              <p>6.1. Сайт содержит материалы 18+.</p>
              <p>6.2. Запрещено использовать сайт несовершеннолетним.</p>
            </section>

            <section>
              <h3 className="font-bold text-base mb-2">7. Согласие</h3>
              <p className="font-bold">Продолжая использование сайта gomo6, пользователь подтверждает:</p>
              <ul className="list-disc list-inside ml-4 space-y-1">
                <li>что ему есть 18 лет;</li>
                <li>что он ознакомлен с правилами и согласен с ними;</li>
                <li>что публикует контент на свой страх и риск.</li>
              </ul>
            </section>
          </div>
        </ScrollArea>
        <div className="flex gap-2 justify-end mt-4">
          {canDecline && (
            <Button variant="outline" onClick={onDecline}>
              Покинуть сайт
            </Button>
          )}
          <Button onClick={onAccept}>
            Согласен
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}