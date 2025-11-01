import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PrivacyPolicyProps {
  open: boolean;
  onClose: () => void;
}

export const PrivacyPolicy = ({ open, onClose }: PrivacyPolicyProps) => {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-background border-border max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Политика конфиденциальности</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <section>
            <h3 className="font-bold mb-2">1. Сбор информации</h3>
            <p>
              Мы собираем минимально необходимую информацию для функционирования сервиса:
              email адрес при регистрации, публикуемый контент (посты, изображения),
              информацию о взаимодействии с сайтом.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">2. Использование информации</h3>
            <p>
              Собранная информация используется исключительно для обеспечения работы
              платформы, модерации контента и улучшения качества сервиса.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">3. Хранение данных</h3>
            <p>
              Ваши данные хранятся на защищенных серверах. Мы применяем современные
              методы шифрования и защиты информации.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">4. Передача третьим лицам</h3>
            <p>
              Мы не продаем и не передаем ваши персональные данные третьим лицам,
              за исключением случаев, предусмотренных законом.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">5. Cookies</h3>
            <p>
              Мы используем cookies для обеспечения функционирования сессий и
              улучшения пользовательского опыта.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">6. Ваши права</h3>
            <p>
              Вы имеете право на доступ к своим данным, их изменение и удаление.
              Для этого обратитесь к администрации сайта.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">7. Изменения политики</h3>
            <p>
              Мы оставляем за собой право вносить изменения в данную политику.
              Актуальная версия всегда доступна на сайте.
            </p>
          </section>

          <section>
            <h3 className="font-bold mb-2">8. Контакты</h3>
            <p>
              По вопросам конфиденциальности обращайтесь к администрации через
              форму обратной связи на сайте.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};
