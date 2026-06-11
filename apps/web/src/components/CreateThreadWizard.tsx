import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/integrations/api/compat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { X, Plus, Eye, EyeOff, ImagePlus, Minimize2, Maximize2 } from "lucide-react";
import { InlineFormattingToolbar } from "@/components/InlineFormattingToolbar";
import { renderPreviewContent } from "@/utils/emojiUtils";
import { ImageUpload } from "@/components/ImageUpload";
import { storageUrl, uploadFile } from "@/utils/storage";

interface Board {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_gomosub?: boolean | null;
}

interface CreateThreadWizardProps {
  boards: Board[];
  onClose: () => void;
}

type WizardStep = 'board' | 'content' | 'tags' | 'preview';

interface ThreadTags {
  content?: string;
  format?: string;
  atmosphere?: string;
  flag: string; // required
}

const CONTENT_TAGS_WITH_DESC = [
  { value: 'anime', label: 'Аниме', description: 'Обсуждение аниме и манги' },
  { value: 'games', label: 'Игры', description: 'Компьютерные и видеоигры' },
  { value: 'music', label: 'Музыка', description: 'Музыка и музыканты' },
  { value: 'movies', label: 'Фильмы', description: 'Обсуждение фильмов и сериалов' },
  { value: 'comics', label: 'Комиксы', description: 'Комиксы и графические романы' },
  { value: 'humor', label: 'Юмор', description: 'Мемы, шутки, абсурд' },
  { value: 'literature', label: 'Литература', description: 'Книги и писатели' },
  { value: 'stories', label: 'Истории', description: 'Рассказы и повествования' }
];

const FORMAT_TAGS_WITH_DESC = [
  { value: 'shitpost', label: 'Щитпост', description: 'Мемы, юмор, абсурд' },
  { value: 'discussion', label: 'Обсуждение', description: 'Обычная дискуссия' },
  { value: 'question', label: 'Вопрос', description: 'Вопросы, советы' },
  { value: 'confession', label: 'Признание', description: 'Личные истории' },
  { value: 'story', label: 'Рассказ', description: 'Короткие рассказы' },
  { value: 'guide', label: 'Гайд', description: 'Инструкции, гайды' }
];

const ATMOSPHERE_TAGS_WITH_DESC = [
  { value: 'serious', label: 'Серьёзно', description: 'Серьёзная дискуссия' },
  { value: 'irony', label: 'Ирония', description: 'Ироничные посты, сарказм' },
  { value: 'vent', label: 'Выплеск', description: 'Жалобы, эмоции' },
  { value: 'doom', label: 'Тьма', description: 'Пессимистические темы' }
];

const FLAG_TAGS_WITH_DESC = [
  { value: 'normal', label: 'Обычный', description: 'Обычный тред' },
  { value: 'ephemeral', label: 'Временный', description: 'Самоуничтожение' },
  { value: 'night', label: 'Ночной', description: 'Ночные треды' }
];

export const CreateThreadWizard = ({ boards, onClose }: CreateThreadWizardProps) => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WizardStep>('board');
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(boards?.[0] || null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [threadImageUrl, setThreadImageUrl] = useState('');
  const [tags, setTags] = useState<ThreadTags>({ flag: 'normal' });
  const [isExpandedView, setIsExpandedView] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleBoardSelect = (board: Board) => {
    // Redirect to create page with board slug
    window.location.href = `/create?board=${board.slug}`;
  };

  const handleTagSelect = (category: keyof ThreadTags, value: string) => {
    setTags(prev => ({ ...prev, [category]: value }));
  };

  const handleCreateThread = async () => {
    if (!selectedBoard || !title.trim() || !content.trim()) {
      toast.error('Заполните все обязательные поля');
      return;
    }

    if (!tags.flag) {
      toast.error('Выберите тип треда');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await api.auth.getUser();
      if (!user) {
        toast.error('Необходимо войти в систему');
        return;
      }

      const { data, error } = await api
        .from('threads')
        .insert({
          board_id: selectedBoard.id,
          user_id: user.id,
          title: title.trim(),
          content: content.trim(),
          image_url: threadImageUrl || null,
          image_urls: imageUrls.length > 0 ? imageUrls : null,
          tags: tags
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Тред создан!');
      navigate(`/${selectedBoard.slug}/thread/${data.id}`);
      onClose();
    } catch (error) {
      console.error('Error creating thread:', error);
      toast.error('Ошибка при создании треда');
    } finally {
      setLoading(false);
    }
  };

  const renderBoardStep = () => (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">Выберите доску</h2>
        <p className="text-muted-foreground">Где будет опубликован ваш тред?</p>
      </div>

      <div className="grid gap-3 max-h-96 overflow-y-auto">
        {boards.map((board) => (
          <Card
            key={board.id}
            className="cursor-pointer hover:bg-accent transition-colors"
            onClick={() => handleBoardSelect(board)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">/{board.slug}/</div>
                  <div className="text-sm text-muted-foreground">{board.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{board.description}</div>
                </div>
                <div className="text-2xl">📌</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderContentStep = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">Создание треда</h2>
        <p className="text-muted-foreground">в /{selectedBoard?.slug}/</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">Заголовок</label>
          <Input
            placeholder="Тема треда..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-lg"
          />
        </div>

        {!isExpandedView && (
          <div>
            <label className="text-sm font-medium mb-2 block">Основное изображение треда</label>
            <div className="flex gap-2">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                id="thread-image"
                  onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    // Handle thread image upload
                    try {
                      const imageKey = `threads/${Date.now()}-${file.name}`;
                      await uploadFile('content', imageKey, file);
                      setThreadImageUrl(imageKey);
                    } catch (error) {
                      console.error('Error uploading thread image:', error);
                      toast.error('Ошибка загрузки изображения');
                    }
                  }
                }}
              />
              <label htmlFor="thread-image" className="cursor-pointer">
                <Button type="button" variant="outline" size="sm">
                  <ImagePlus className="h-4 w-4 mr-2" />
                  {threadImageUrl ? 'Изменить' : 'Добавить'}
                </Button>
              </label>
              {threadImageUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setThreadImageUrl('')}
                >
                  <X className="h-4 w-4 mr-2" />
                  Удалить
                </Button>
              )}
            </div>
            {threadImageUrl && (
              <div className="mt-2">
                <img
                  src={storageUrl("content", threadImageUrl) || threadImageUrl}
                  alt="Thread image"
                  className="max-h-32 rounded border"
                />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">Содержание</label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpandedView(!isExpandedView)}
          >
            {isExpandedView ? <Minimize2 className="h-4 w-4 mr-2" /> : <Maximize2 className="h-4 w-4 mr-2" />}
            {isExpandedView ? 'Свернуть' : 'Развернуть'}
          </Button>
        </div>

        {isExpandedView ? (
          <div className="space-y-4">
            <InlineFormattingToolbar onFormat={(prefix, suffix) => {
              const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
              if (textarea) {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const selectedText = content.substring(start, end);
                const newText = prefix + selectedText + suffix;
                setContent(content.substring(0, start) + newText + content.substring(end));
                setTimeout(() => {
                  textarea.focus();
                  textarea.setSelectionRange(start + prefix.length, start + prefix.length + selectedText.length);
                }, 0);
              }
            }} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Редактор</label>
                <Textarea
                  placeholder="Напишите содержание треда..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[300px] resize-none"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Предпросмотр</label>
                <div className="border rounded-lg p-3 min-h-[300px] max-h-[300px] overflow-y-auto bg-muted/20">
                  <div className="text-sm break-words">
                    {content ? (
                      <div>{renderPreviewContent(content, 'thread')}</div>
                    ) : (
                      <span className="text-muted-foreground">Начните писать...</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Дополнительные изображения</label>
              <ImageUpload
                onImagesUploaded={setImageUrls}
                maxImages={10}
              />
            </div>
          </div>
        ) : (
          <Textarea
            placeholder="Напишите содержание треда..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[120px] resize-none"
          />
        )}
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setCurrentStep('board')}>
          ← Назад
        </Button>
        <Button onClick={() => setCurrentStep('tags')}>
          Далее →
        </Button>
      </div>
    </div>
  );

  const renderTagsStep = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">Выберите теги</h2>
        <p className="text-muted-foreground">Помогите другим найти ваш тред</p>
      </div>

      {/* Required flag tag */}
      <div>
        <h3 className="font-semibold mb-3 text-red-600">* Обязательно: Тип треда</h3>
        <div className="grid grid-cols-2 gap-2">
          {FLAG_TAGS_WITH_DESC.map((tag) => (
            <button
              key={tag.value}
              onClick={() => handleTagSelect('flag', tag.value)}
              className={`p-3 border rounded-lg text-left hover:bg-accent transition-colors ${
                tags.flag === tag.value ? 'border-primary bg-primary/10' : 'border-border'
              }`}
            >
              <div className="font-medium">{tag.label}</div>
              <div className="text-xs text-muted-foreground">{tag.description}</div>
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Content tag */}
      <div>
        <h3 className="font-semibold mb-3">Тематика (опционально)</h3>
        <div className="grid grid-cols-3 gap-2">
          {CONTENT_TAGS_WITH_DESC.map((tag) => (
            <button
              key={tag.value}
              onClick={() => handleTagSelect('content', tag.value)}
              className={`p-2 border rounded text-sm hover:bg-accent transition-colors ${
                tags.content === tag.value ? 'border-primary bg-primary/10' : 'border-border'
              }`}
            >
              {tag.label}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Format tag */}
      <div>
        <h3 className="font-semibold mb-3">Формат (опционально)</h3>
        <div className="grid grid-cols-3 gap-2">
          {FORMAT_TAGS_WITH_DESC.map((tag) => (
            <button
              key={tag.value}
              onClick={() => handleTagSelect('format', tag.value)}
              className={`p-2 border rounded text-sm hover:bg-accent transition-colors ${
                tags.format === tag.value ? 'border-green-500 bg-green-500/10' : 'border-border'
              }`}
            >
              {tag.label}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Atmosphere tag */}
      <div>
        <h3 className="font-semibold mb-3">Атмосфера (опционально)</h3>
        <div className="grid grid-cols-2 gap-2">
          {ATMOSPHERE_TAGS_WITH_DESC.map((tag) => (
            <button
              key={tag.value}
              onClick={() => handleTagSelect('atmosphere', tag.value)}
              className={`p-2 border rounded text-sm hover:bg-accent transition-colors ${
                tags.atmosphere === tag.value ? 'border-purple-500 bg-purple-500/10' : 'border-border'
              }`}
            >
              {tag.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setCurrentStep('content')}>
          ← Назад
        </Button>
        <Button onClick={() => setCurrentStep('preview')}>
          Предпросмотр →
        </Button>
      </div>
    </div>
  );

  const renderPreviewStep = () => (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">Предпросмотр</h2>
        <p className="text-muted-foreground">Так будет выглядеть ваш тред</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <span className="text-sm font-medium">Вы</span>
            </div>
            <div className="flex-1">
              <div className="font-semibold">Ваш тред</div>
              <div className="text-xs text-muted-foreground">
                в /{selectedBoard?.slug}/ • только что
              </div>
            </div>
          </div>

          <CardTitle className="text-left">{title || 'Заголовок треда'}</CardTitle>

          {/* Preview tags */}
          <div className="flex flex-wrap gap-1 mt-2">
            {tags.content && (
              <Badge variant="secondary" className="text-xs">
                {CONTENT_TAGS_WITH_DESC.find(t => t.value === tags.content)?.label}
              </Badge>
            )}
            {tags.format && (
              <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600">
                {FORMAT_TAGS_WITH_DESC.find(t => t.value === tags.format)?.label}
              </Badge>
            )}
            {tags.atmosphere && (
              <Badge variant="secondary" className="text-xs bg-purple-500/10 text-purple-600">
                {ATMOSPHERE_TAGS_WITH_DESC.find(t => t.value === tags.atmosphere)?.label}
              </Badge>
            )}
            {tags.flag && tags.flag !== 'normal' && (
              <Badge variant="secondary" className="text-xs bg-orange-500/10 text-orange-600">
                {FLAG_TAGS_WITH_DESC.find(t => t.value === tags.flag)?.label}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {threadImageUrl && (
            <div className="mb-4">
              <img src={threadImageUrl} alt="Thread" className="w-full max-h-64 object-cover rounded" />
            </div>
          )}

          <div className="text-sm break-words">
            {content ? (
              <div>{renderPreviewContent(content, 'thread')}</div>
            ) : (
              <span className="text-muted-foreground">Содержание треда...</span>
            )}
          </div>

          {imageUrls.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {imageUrls.slice(0, 4).map((url, index) => (
                <img
                  key={index}
                  src={url}
                  alt={`Image ${index + 1}`}
                  className="w-full h-24 object-cover rounded border"
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={() => setCurrentStep('tags')}>
          ← Назад
        </Button>
        <Button onClick={handleCreateThread} disabled={loading}>
          {loading ? 'Создание...' : 'Создать тред'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Шаг {currentStep === 'board' ? '1' : currentStep === 'content' ? '2' : currentStep === 'tags' ? '3' : '4'} из 4
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="min-h-[400px]">
          {currentStep === 'board' && renderBoardStep()}
          {currentStep === 'content' && renderContentStep()}
          {currentStep === 'tags' && renderTagsStep()}
          {currentStep === 'preview' && renderPreviewStep()}
        </CardContent>
      </Card>
    </div>
  );
};
