import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Shield, MapPin, ExternalLink } from "lucide-react";

export const RussianBlock = () => {
  const [userLocation, setUserLocation] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Проверяем страну через IP
    const checkLocation = async () => {
      try {
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();

        if (data.country_code === 'RU') {
          setUserLocation('RU');
        }
      } catch (error) {
        // В случае ошибки API, проверяем через другой сервис
        try {
          const response = await fetch('https://api.ipify.org?format=json');
          const ipData = await response.json();

          // Если IP российский (примерная проверка по диапазону)
          if (ipData.ip && (ipData.ip.startsWith('5.') ||
                           ipData.ip.startsWith('31.') ||
                           ipData.ip.startsWith('37.') ||
                           ipData.ip.startsWith('46.') ||
                           ipData.ip.startsWith('62.') ||
                           ipData.ip.startsWith('77.') ||
                           ipData.ip.startsWith('78.') ||
                           ipData.ip.startsWith('79.') ||
                           ipData.ip.startsWith('80.') ||
                           ipData.ip.startsWith('81.') ||
                           ipData.ip.startsWith('82.') ||
                           ipData.ip.startsWith('83.') ||
                           ipData.ip.startsWith('84.') ||
                           ipData.ip.startsWith('85.') ||
                           ipData.ip.startsWith('86.') ||
                           ipData.ip.startsWith('87.') ||
                           ipData.ip.startsWith('89.') ||
                           ipData.ip.startsWith('90.') ||
                           ipData.ip.startsWith('91.') ||
                           ipData.ip.startsWith('92.') ||
                           ipData.ip.startsWith('93.') ||
                           ipData.ip.startsWith('94.') ||
                           ipData.ip.startsWith('95.') ||
                           ipData.ip.startsWith('109.') ||
                           ipData.ip.startsWith('128.') ||
                           ipData.ip.startsWith('130.') ||
                           ipData.ip.startsWith('141.') ||
                           ipData.ip.startsWith('145.') ||
                           ipData.ip.startsWith('151.') ||
                           ipData.ip.startsWith('158.') ||
                           ipData.ip.startsWith('159.') ||
                           ipData.ip.startsWith('160.') ||
                           ipData.ip.startsWith('161.') ||
                           ipData.ip.startsWith('162.') ||
                           ipData.ip.startsWith('176.') ||
                           ipData.ip.startsWith('178.') ||
                           ipData.ip.startsWith('185.') ||
                           ipData.ip.startsWith('188.') ||
                           ipData.ip.startsWith('193.') ||
                           ipData.ip.startsWith('194.') ||
                           ipData.ip.startsWith('195.') ||
                           ipData.ip.startsWith('212.') ||
                           ipData.ip.startsWith('213.') ||
                           ipData.ip.startsWith('217.') ||
                           ipData.ip.startsWith('218.') ||
                           ipData.ip.startsWith('219.') ||
                           ipData.ip.startsWith('220.') ||
                           ipData.ip.startsWith('221.'))) {
            setUserLocation('RU');
          }
        } catch (secondError) {
          console.log('Could not determine location');
        }
      } finally {
        setIsLoading(false);
      }
    };

    checkLocation();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Проверяем ваше местоположение...</p>
        </div>
      </div>
    );
  }

  if (userLocation !== 'RU') {
    return null; // Показываем обычное приложение
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-card border border-border rounded-2xl p-8 text-center shadow-xl">
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-destructive/10 rounded-full mb-4">
            <Shield className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Доступ ограничен
          </h1>
          <div className="inline-flex items-center gap-2 text-muted-foreground mb-6">
            <MapPin className="w-4 h-4" />
            <span>Обнаружено местоположение: Россия</span>
          </div>
        </div>

        <div className="space-y-6 text-left">
          <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-destructive mb-3">
              Почему доступ ограничен?
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              К сожалению, из-за активной блокировки зарубежных сервисов Роскомнадзором,
              пользователи из России могут испытывать значительные трудности с доступом
              к нашему сайту. Мы используем технологии и сервисы, которые часто блокируются
              в РФ, что делает нормальную работу невозможной.
            </p>
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-primary mb-3">
              Возможные решения
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 bg-primary rounded-full mt-2 flex-shrink-0"></div>
                <div>
                  <p className="font-medium text-foreground">Используйте VPN</p>
                  <p className="text-muted-foreground text-sm">
                    Подключитесь к VPN-серверу в другой стране для обхода блокировок
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 bg-primary rounded-full mt-2 flex-shrink-0"></div>
                <div>
                  <p className="font-medium text-foreground">Proxy-серверы</p>
                  <p className="text-muted-foreground text-sm">
                    Используйте прокси-серверы для доступа к заблокированным ресурсам
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 bg-primary rounded-full mt-2 flex-shrink-0"></div>
                <div>
                  <p className="font-medium text-foreground">Tor Browser</p>
                  <p className="text-muted-foreground text-sm">
                    Альтернативный способ обхода блокировок через сеть Tor
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
            <p>
              <strong>Важно:</strong> Использование VPN и подобных инструментов является
              вашим личным выбором. Мы не несем ответственности за их использование
              и не рекомендуем нарушать законодательство вашей страны.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="flex items-center gap-2"
          >
            Проверить снова
          </Button>
          <Button
            variant="default"
            onClick={() => window.open('https://www.google.com/search?q=vpn+россия', '_blank')}
            className="flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            Найти VPN
          </Button>
        </div>
      </div>
    </div>
  );
};