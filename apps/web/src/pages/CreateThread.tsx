import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { X, Plus, ImagePlus, Minimize2, Maximize2, ArrowLeft } from "lucide-react";
import { ProfileAttachmentUpload } from "@/components/ProfileAttachmentUpload";
import { AttachmentMeta } from "@/types/forum";
import { GomoRichEditor, type GomoRichEditorHandle } from "@/components/GomoRichEditor";

interface Board {
  id: string;
  slug: string;
  name: string;
  description: string;
  is_gomosub?: boolean | null;
}

interface ThreadTags {
  content?: string;
  format?: string;
  atmosphere?: string;
  flag: string; // required
}

interface PollOption {
  id: string;
  text: string;
}

interface Poll {
  question: string;
  options: PollOption[];
  allow_multiple: boolean;
  show_results: boolean;
  allow_change_vote: boolean;
}

const CONTENT_TAGS = [
  { value: 'anime', label: 'Аниме', description: 'Обсуждение аниме и манги' },
  { value: 'games', label: 'Игры', description: 'Компьютерные и видеоигры' },
  { value: 'music', label: 'Музыка', description: 'Музыка и музыканты' },
  { value: 'movies', label: 'Фильмы', description: 'Обсуждение фильмов и сериалов' },
  { value: 'comics', label: 'Комиксы', description: 'Комиксы и графические романы' },
  { value: 'humor', label: 'Юмор', description: 'Мемы, шутки, абсурд' },
  { value: 'literature', label: 'Литература', description: 'Книги и писатели' },
  { value: 'stories', label: 'Истории', description: 'Рассказы и повествования' }
];

const FORMAT_TAGS = [
  { value: 'shitpost', label: 'Щитпост', description: 'Мемы, юмор, абсурд' },
  { value: 'discussion', label: 'Обсуждение', description: 'Обычная дискуссия' },
  { value: 'question', label: 'Вопрос', description: 'Вопросы, советы' },
  { value: 'confession', label: 'Признание', description: 'Личные истории' },
  { value: 'story', label: 'Рассказ', description: 'Короткие рассказы' },
  { value: 'guide', label: 'Гайд', description: 'Инструкции, гайды' }
];

const ATMOSPHERE_TAGS = [
  { value: 'serious', label: 'Серьёзно', description: 'Серьёзная дискуссия' },
  { value: 'irony', label: 'Ирония', description: 'Ироничные посты, сарказм' },
  { value: 'vent', label: 'Выплеск', description: 'Жалобы, эмоции' },
  { value: 'doom', label: 'Тьма', description: 'Пессимистические темы' }
];

const FLAG_TAGS = [
  { value: 'normal', label: 'Обычный', description: 'Обычный тред' },
  { value: 'ephemeral', label: 'Временный', description: 'Самоуничтожение' },
  { value: 'night', label: 'Ночной', description: 'Ночные треды' }
];

const CreateThread = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { slug: gSlug } = useParams();
  const boardSlug = searchParams.get('board') || gSlug || undefined;

  const [board, setBoard] = useState<Board | null>(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boards, setBoards] = useState<Board[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [contentJson, setContentJson] = useState<unknown>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]); // legacy image urls
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [threadImageUrl, setThreadImageUrl] = useState('');
  const [tags, setTags] = useState<ThreadTags>({ flag: 'normal' });
  const [showBoardDialog, setShowBoardDialog] = useState(!boardSlug);

  const [ephemeralSettings, setEphemeralSettings] = useState<{
    type: 'time' | 'messages';
    value: number;
  }>({
    type: 'time',
    value: 24 // 24 часа по умолчанию
  });
  const [isExpandedView, setIsExpandedView] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const editorRef = useRef<GomoRichEditorHandle>(null);
  const [poll, setPoll] = useState<Poll>({
    question: '',
    options: [
      { id: '1', text: '' },
      { id: '2', text: '' }
    ],
    allow_multiple: false,
    show_results: false,
    allow_change_vote: false
  });

  // Poll management functions
  const addPollOption = () => {
    const newId = (poll.options.length + 1).toString();
    setPoll(prev => ({
      ...prev,
      options: [...prev.options, { id: newId, text: '' }]
    }));
  };

  const updatePollOption = (id: string, text: string) => {
    setPoll(prev => ({
      ...prev,
      options: prev.options.map(option =>
        option.id === id ? { ...option, text } : option
      )
    }));
  };

  const removePollOption = (id: string) => {
    if (poll.options.length > 2) {
      setPoll(prev => ({
        ...prev,
        options: prev.options.filter(option => option.id !== id)
      }));
    }
  };

  const resetPoll = () => {
    setPoll({
      question: '',
      options: [
        { id: '1', text: '' },
        { id: '2', text: '' }
      ],
      allow_multiple: false,
      show_results: false,
      allow_change_vote: false
    });
    setShowPoll(false);
  };

  useEffect(() => {
    // Load available boards for picker
    const loadBoards = async () => {
      const { data } = await supabase
        .from("boards")
        .select("id, slug, name, description, is_gomosub")
        .eq("is_rules_board", false)
        .eq("is_gomosub", false)
        .order("created_at", { ascending: true });

      if (data) {
        // Hide service boards
        const filtered = data.filter(b => b.slug !== 'faq' && b.slug !== 'bugs');
        setBoards(filtered.slice(0, 4));
      }
    };

    loadBoards();
  }, []);

  useEffect(() => {
    const loadBoard = async () => {
      setBoardLoading(true);

      if (!boardSlug) {
        // If no board specified, open board picker
        setShowBoardDialog(true);
        setBoard(null);
        setBoardLoading(false);
        return;
      }

      const { data: boardData } = await supabase
        .from("boards")
        .select("*")
        .eq("slug", boardSlug)
        .single();

      if (!boardData) {
        toast.error('Доска не найдена, выберите другую');
        setShowBoardDialog(true);
        setBoard(null);
        setBoardLoading(false);
        return;
      }

      setBoard(boardData);
      setBoardLoading(false);
    };

    loadBoard();
  }, [boardSlug, navigate]);

  // Keep legacy imageUrls in sync for backward compatibility (old components rely on it)
  useEffect(() => {
    const imgs = attachments.filter(att => att.type === 'image').map(att => att.url);
    setImageUrls(imgs);
  }, [attachments]);

  const handleBoardChoose = (selected: Board) => {
    setShowBoardDialog(false);
    // Keep UX simple: reload with query param for consistency
    navigate(`/create?board=${selected.slug}`);
  };

  const handleTagSelect = (category: keyof ThreadTags, value: string) => {
    setTags(prev => ({ ...prev, [category]: value }));
  };

  const handleCreateThread = async () => {
    if (!board || !title.trim() || !content.trim()) {
      toast.error('Заполните все обязательные поля');
      return;
    }

    if (!tags.flag) {
      toast.error('Выберите тип треда');
      return;
    }

    // Validate poll if enabled
    if (showPoll) {
      if (!poll.question.trim()) {
        toast.error('Введите вопрос голосования');
        return;
      }
      if (poll.options.filter(option => option.text.trim()).length < 2) {
        toast.error('Добавьте минимум 2 варианта ответа');
        return;
      }
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Необходимо войти в систему');
        return;
      }

      const imageUrlsFromAttachments = attachments
        .filter(att => att.type === 'image')
        .map(att => att.url);

      const threadData: any = {
        board_id: board.id,
        user_id: user.id,
        title: title.trim(),
        content: content.trim(),
        content_json: contentJson,
        image_url: threadImageUrl || imageUrlsFromAttachments[0] || null,
        tags: tags,
        attachments: attachments.length > 0 ? attachments : null,
      };

      // Explicitly set image_urls field
      if (imageUrlsFromAttachments.length > 0) {
        threadData.image_urls = imageUrlsFromAttachments;
      } else if (imageUrls.length > 0) {
        threadData.image_urls = imageUrls;
      }

      // Add poll if enabled
      if (showPoll && poll.question.trim()) {
        threadData.poll = {
          question: poll.question.trim(),
          options: poll.options.filter(option => option.text.trim()).map(option => ({
            id: option.id,
            text: option.text.trim()
          })),
          allow_multiple: poll.allow_multiple,
          show_results: poll.show_results,
          allow_change_vote: poll.allow_change_vote
        };
      }

      // Add ephemeral settings if applicable
      if (tags.flag === 'ephemeral') {
        threadData.ephemeral_type = ephemeralSettings.type;
        threadData.ephemeral_value = ephemeralSettings.value;
      }

      const { data, error } = await supabase
        .from('threads')
        .insert(threadData)
        .select()
        .single();

      if (error) throw error;

      // Auto-subscribe to thread notifications
      const { error: subscriptionError } = await supabase
        .from('thread_subscriptions')
        .insert({
          user_id: user.id,
          thread_id: data.id
        });

      if (subscriptionError && subscriptionError.code !== '23505') { // Ignore duplicate key error
        console.error('Error subscribing to thread:', subscriptionError);
        // Don't fail creation if subscription fails
      }

      // Process ephemeral thread after creation
      if (tags.flag === 'ephemeral') {
        const { error: ephemeralError } = await supabase.rpc('process_ephemeral_thread', {
          p_thread_id: data.id,
          p_ephemeral_type: ephemeralSettings.type,
          p_ephemeral_value: ephemeralSettings.value
        });

        if (ephemeralError) {
          console.error('Error processing ephemeral thread:', ephemeralError);
          // Don't fail the creation, just log the error
        }
      }

      toast.success('Тред создан!');
      const prefix = board?.is_gomosub ? "/g" : "";
      navigate(`${prefix}/${board.slug}/thread/${data.id}`);
      setAttachments([]);
      setImageUrls([]);
    } catch (error) {
      console.error('Error creating thread:', error);
      toast.error('Ошибка при создании треда');
    } finally {
      setLoading(false);
    }
  };

  const renderBoardDialog = (
    <Dialog open={showBoardDialog} onOpenChange={setShowBoardDialog}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Выберите доску</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 max-h-[480px] overflow-y-auto">
          {boards.map((b) => (
            <Card
              key={b.id}
              className="cursor-pointer hover:bg-accent transition-colors"
              onClick={() => handleBoardChoose(b)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">/{b.slug}/</div>
                    <div className="text-sm text-muted-foreground">{b.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{b.description}</div>
                  </div>
                  <div className="text-2xl">📌</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );

  if (!board) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        {boardLoading ? (
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        ) : (
          <div className="text-center text-muted-foreground">
            Выберите доску для создания треда
          </div>
        )}
        {renderBoardDialog}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="outline" size="sm" onClick={() => navigate('/')} className="hover:bg-primary hover:text-primary-foreground">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Назад
              </Button>
              <div>
                <h1 className="text-lg font-semibold">Создание треда</h1>
                <p className="text-sm text-muted-foreground">в /{board.slug}/ - {board.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBoardDialog(true)}
                className="hover:bg-primary hover:text-primary-foreground"
              >
                Сменить доску
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4">
        <div className="space-y-6">
            {/* Title */}
            <div>
              <label className="text-sm font-medium mb-2 block">Заголовок</label>
              <Input
                placeholder="Тема треда..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-lg"
              />
            </div>

            {/* Thread Image */}
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
                      try {
                        const { data, error } = await supabase.storage
                          .from('post-images')
                          .upload(`threads/${Date.now()}-${file.name}`, file);

                        if (error) throw error;

                        const { data: { publicUrl } } = supabase.storage
                          .from('post-images')
                          .getPublicUrl(data.path);

                        setThreadImageUrl(publicUrl);
                      } catch (error) {
                        console.error('Error uploading thread image:', error);
                        toast.error('Ошибка загрузки изображения');
                      } finally {
                        // Reset input value to allow selecting the same file again
                        e.target.value = '';
                      }
                    }
                  }}
                />
                <label
                  htmlFor="thread-image"
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-border rounded-md bg-background hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors cursor-pointer"
                >
                  <ImagePlus className="h-4 w-4" />
                  {threadImageUrl ? 'Изменить' : 'Добавить изображение'}
                </label>
                {threadImageUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setThreadImageUrl('')}
                    className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 transition-colors"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Удалить
                  </Button>
                )}
              </div>
              {threadImageUrl && (
                <div className="mt-3 p-3 border rounded-lg bg-muted/20">
                  <p className="text-xs text-muted-foreground mb-2">Предпросмотр основного изображения:</p>
                  <img src={threadImageUrl} alt="Thread image" className="max-h-48 w-full object-cover rounded border" />
                </div>
              )}
            </div>

            {/* Content */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Содержание</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsExpandedView(!isExpandedView)}
                  className="hover:bg-primary hover:text-primary-foreground"
                >
                  {isExpandedView ? <Minimize2 className="h-4 w-4 mr-2" /> : <Maximize2 className="h-4 w-4 mr-2" />}
                  {isExpandedView ? 'Свернуть' : 'Расширить'}
                </Button>
              </div>

              {isExpandedView ? (
                <div className="space-y-4">
                  <GomoRichEditor
                    ref={editorRef}
                    contentJson={contentJson}
                    legacyContent={content}
                    onChange={({ json, text }) => {
                      setContentJson(json);
                      setContent(text);
                    }}
                    onSubmit={handleCreateThread}
                    placeholder="Напишите содержание треда..."
                    minHeightClassName="min-h-[400px]"
                  />
                </div>
              ) : (
                <GomoRichEditor
                  ref={editorRef}
                  contentJson={contentJson}
                  legacyContent={content}
                  onChange={({ json, text }) => {
                    setContentJson(json);
                    setContent(text);
                  }}
                  onSubmit={handleCreateThread}
                  placeholder="Напишите содержание треда..."
                  minHeightClassName="min-h-[120px]"
                />
              )}
            </div>

            {/* Attachments: images, video, audio, files */}
            <div>
              <label className="text-sm font-medium mb-2 block">Файлы / медиа</label>
              <ProfileAttachmentUpload value={attachments} onChange={setAttachments} maxFiles={8} />
            </div>

            {/* Poll */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Голосование</label>
                {!showPoll && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPoll(true)}
                    className="text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Добавить голосование
                  </Button>
                )}
              </div>

              {showPoll && (
                <Card className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Настройки голосования</h4>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={resetPoll}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Вопрос голосования</label>
                    <Input
                      placeholder="Введите вопрос голосования..."
                      value={poll.question}
                      onChange={(e) => setPoll(prev => ({ ...prev, question: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Варианты ответов</label>
                    <div className="space-y-2">
                      {poll.options.map((option, index) => (
                        <div key={option.id} className="flex gap-2">
                          <Input
                            placeholder={`Вариант ${index + 1}`}
                            value={option.text}
                            onChange={(e) => updatePollOption(option.id, e.target.value)}
                          />
                          {poll.options.length > 2 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => removePollOption(option.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addPollOption}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Добавить вариант
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Количество ответов</label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={poll.allow_multiple === false ? "default" : "outline"}
                          size="sm"
                          onClick={() => setPoll(prev => ({ ...prev, allow_multiple: false }))}
                        >
                          1 ответ
                        </Button>
                        <Button
                          type="button"
                          variant={poll.allow_multiple === true ? "default" : "outline"}
                          size="sm"
                          onClick={() => setPoll(prev => ({ ...prev, allow_multiple: true }))}
                        >
                          Неограниченно
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="show-results"
                        checked={poll.show_results}
                        onChange={(e) => setPoll(prev => ({ ...prev, show_results: e.target.checked }))}
                        className="rounded"
                      />
                      <label htmlFor="show-results" className="text-sm">
                        Разрешить видеть, кто как проголосовал
                      </label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="allow-change"
                        checked={poll.allow_change_vote}
                        onChange={(e) => setPoll(prev => ({ ...prev, allow_change_vote: e.target.checked }))}
                        className="rounded"
                      />
                      <label htmlFor="allow-change" className="text-sm">
                        Разрешить проголосовавшим изменять свой голос
                      </label>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* Tags */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Теги</h3>

              {/* Required flag tag */}
              <div>
                <h4 className="font-medium mb-3 text-red-600">* Обязательно: Тип треда</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {FLAG_TAGS.map((tag) => (
                    <button
                      key={tag.value}
                      onClick={() => handleTagSelect('flag', tag.value)}
                      className={`p-3 border rounded-lg text-left hover:bg-primary/5 transition-colors ${
                        tags.flag === tag.value ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                      }`}
                    >
                      <div className="font-medium text-sm">{tag.label}</div>
                      <div className="text-xs text-muted-foreground">{tag.description}</div>
                    </button>
                  ))}
                </div>

                {/* Ephemeral settings */}
                {tags.flag === 'ephemeral' && (
                  <div className="mt-4 p-4 border border-orange-200 bg-orange-50/50 rounded-lg">
                    <h5 className="font-medium mb-3 text-orange-800">⚠️ Настройки самоуничтожения</h5>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium mb-2">Тип уничтожения:</label>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="ephemeral-type"
                              value="time"
                              checked={ephemeralSettings.type === 'time'}
                              onChange={(e) => setEphemeralSettings(prev => ({
                                ...prev,
                                type: e.target.value as 'time' | 'messages'
                              }))}
                            />
                            <span className="text-sm">По времени</span>
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="ephemeral-type"
                              value="messages"
                              checked={ephemeralSettings.type === 'messages'}
                              onChange={(e) => setEphemeralSettings(prev => ({
                                ...prev,
                                type: e.target.value as 'time' | 'messages'
                              }))}
                            />
                            <span className="text-sm">По количеству сообщений</span>
                          </label>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-2">
                          {ephemeralSettings.type === 'time' ? 'Время уничтожения (часы):' : 'Количество сообщений:'}
                        </label>
                        <input
                          type="number"
                          min="1"
                          max={ephemeralSettings.type === 'time' ? 168 : 100}
                          value={ephemeralSettings.value}
                          onChange={(e) => setEphemeralSettings(prev => ({
                            ...prev,
                            value: parseInt(e.target.value) || 1
                          }))}
                          className="px-3 py-2 border border-border rounded-md text-sm w-32"
                        />
                        <span className="text-xs text-muted-foreground ml-2">
                          {ephemeralSettings.type === 'time'
                            ? `(макс. 168 часов = 7 дней)`
                            : `(макс. 100 сообщений)`
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Night thread validation */}
                {tags.flag === 'night' && (
                  <div className="mt-4 p-4 border border-blue-200 bg-blue-50/50 rounded-lg">
                    <h5 className="font-medium mb-2 text-blue-800">🌙 Ночной тред</h5>
                    <p className="text-sm text-blue-700">
                      Ночные треды можно создавать только с 23:00 до 6:00. Тред будет автоматически удален в 6:00 утра.
                    </p>
                  </div>
                )}
              </div>

              {/* Content tag */}
              <div>
                <h4 className="font-medium mb-3">Тематика (опционально)</h4>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                  {CONTENT_TAGS.map((tag) => (
                    <button
                      key={tag.value}
                      onClick={() => handleTagSelect('content', tag.value)}
                      className={`p-2 border rounded text-sm hover:bg-primary/5 transition-colors ${
                        tags.content === tag.value ? 'border-blue-500 bg-blue-500/10 text-blue-600' : 'border-border'
                      }`}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Format tag */}
              <div>
                <h4 className="font-medium mb-3">Формат (опционально)</h4>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {FORMAT_TAGS.map((tag) => (
                    <button
                      key={tag.value}
                      onClick={() => handleTagSelect('format', tag.value)}
                      className={`p-2 border rounded text-sm hover:bg-primary/5 transition-colors ${
                        tags.format === tag.value ? 'border-green-600 bg-green-600/10 text-green-700' : 'border-border'
                      }`}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Atmosphere tag */}
              <div>
                <h4 className="font-medium mb-3">Атмосфера (опционально)</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {ATMOSPHERE_TAGS.map((tag) => (
                    <button
                      key={tag.value}
                      onClick={() => handleTagSelect('atmosphere', tag.value)}
                      className={`p-2 border rounded text-sm hover:bg-primary/5 transition-colors ${
                        tags.atmosphere === tag.value ? 'border-purple-600 bg-purple-600/10 text-purple-700' : 'border-border'
                      }`}
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Create Button */}
            <div className="flex justify-end pt-6">
              <Button onClick={handleCreateThread} disabled={loading} size="lg">
                {loading ? 'Создание...' : 'Создать тред'}
              </Button>
            </div>
          </div>
      </div>

      {renderBoardDialog}
    </div>
  );
};

export default CreateThread;
