import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PentagramLoader } from "@/components/PentagramLoader";
import {
  Plus,
  Trash2,
  Edit2,
  Gift,
  X,
  Search,
  Package,
  Star,
  Eye,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";

interface GiftItem {
  id: string;
  name: string;
  description?: string;
  image_url: string;
  price: number;
  category: string;
  is_active: boolean;
  is_limited: boolean;
  max_quantity?: number;
  sold_count: number;
  sort_order: number;
  created_at: string;
}

interface GiftForm {
  name: string;
  description: string;
  image_url: string;
  price: number;
  category: string;
  is_active: boolean;
  is_limited: boolean;
  max_quantity: number;
  sort_order: number;
}

const defaultForm: GiftForm = {
  name: "",
  description: "",
  image_url: "",
  price: 10,
  category: "general",
  is_active: true,
  is_limited: false,
  max_quantity: 0,
  sort_order: 0,
};

const categoryColors: Record<string, string> = {
  general: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  rare: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  epic: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  legendary: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  special: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

const GiftAdmin = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingGift, setEditingGift] = useState<GiftItem | null>(null);
  const [form, setForm] = useState<GiftForm>(defaultForm);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  useEffect(() => {
    api.getSession().then(({ session }) => {
      if (!session) navigate("/login?redirect=/gifts");
      setSessionChecked(true);
    });
  }, []);

  const { data: gifts, isLoading } = useQuery({
    queryKey: ["admin-gifts"],
    queryFn: async () => {
      const res = await api.fetch("/api/v1/admin/gifts");
      if (!res.ok) throw new Error("Failed to fetch gifts");
      const json = await res.json();
      return json.data as GiftItem[];
    },
    enabled: sessionChecked,
  });

  const createMutation = useMutation({
    mutationFn: async (data: GiftForm) => {
      const res = await api.fetch("/api/v1/admin/gifts", {
        method: "POST",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to create gift");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-gifts"] });
      toast.success("Подарок создан");
      setShowForm(false);
      setForm(defaultForm);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<GiftForm> }) => {
      const res = await api.fetch(`/api/v1/admin/gifts/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to update gift");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-gifts"] });
      toast.success("Подарок обновлён");
      setShowForm(false);
      setEditingGift(null);
      setForm(defaultForm);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.fetch(`/api/v1/admin/gifts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete gift");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-gifts"] });
      toast.success("Подарок деактивирован");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleEdit = (gift: GiftItem) => {
    setEditingGift(gift);
    setForm({
      name: gift.name,
      description: gift.description || "",
      image_url: gift.image_url,
      price: gift.price,
      category: gift.category,
      is_active: gift.is_active,
      is_limited: gift.is_limited,
      max_quantity: gift.max_quantity || 0,
      sort_order: gift.sort_order,
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.image_url.trim() || form.price <= 0) {
      toast.error("Заполните обязательные поля");
      return;
    }
    if (editingGift) {
      updateMutation.mutate({ id: editingGift.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingGift(null);
    setForm(defaultForm);
  };

  const filteredGifts = gifts?.filter((gift) => {
    const matchesSearch =
      !searchQuery ||
      gift.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      gift.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = filterCategory === "all" || gift.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = Array.from(new Set(gifts?.map((g) => g.category) || []));
  const totalSold = gifts?.reduce((sum, g) => sum + g.sold_count, 0) || 0;
  const activeCount = gifts?.filter((g) => g.is_active).length || 0;

  if (!sessionChecked || isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Подарки</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Управляйте каталогом подарков для пользователей
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditingGift(null); setForm(defaultForm); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" />
            Добавить подарок
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Package className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{gifts?.length || 0}</p>
                <p className="text-[11px] text-muted-foreground">Всего</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Eye className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeCount}</p>
                <p className="text-[11px] text-muted-foreground">Активных</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-violet-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalSold}</p>
                <p className="text-[11px] text-muted-foreground">Продано</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Star className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{categories.length}</p>
                <p className="text-[11px] text-muted-foreground">Категорий</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-emerald-500/20">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-lg">
              {editingGift ? "Редактировать подарок" : "Новый подарок"}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={handleCancel} className="h-8 w-8 p-0">
              <X className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">Название *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Название подарка"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="image_url" className="text-sm font-medium">URL изображения *</Label>
                <Input
                  id="image_url"
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  placeholder="path/to/image.png"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price" className="text-sm font-medium">Цена (gарма) *</Label>
                <Input
                  id="price"
                  type="number"
                  min={1}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category" className="text-sm font-medium">Категория</Label>
                <Input
                  id="category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="general"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sort_order" className="text-sm font-medium">Порядок сортировки</Label>
                <Input
                  id="sort_order"
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                />
              </div>
              {form.is_limited && (
                <div className="space-y-2">
                  <Label htmlFor="max_quantity" className="text-sm font-medium">Макс. количество</Label>
                  <Input
                    id="max_quantity"
                    type="number"
                    min={1}
                    value={form.max_quantity}
                    onChange={(e) => setForm({ ...form, max_quantity: parseInt(e.target.value) || 0 })}
                  />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">Описание</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Описание подарка"
                rows={2}
              />
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2.5">
                <Switch
                  id="is_active"
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                <Label htmlFor="is_active" className="text-sm">Активен</Label>
              </div>
              <div className="flex items-center gap-2.5">
                <Switch
                  id="is_limited"
                  checked={form.is_limited}
                  onCheckedChange={(v) => setForm({ ...form, is_limited: v })}
                />
                <Label htmlFor="is_limited" className="text-sm">Лимитированный</Label>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending} className="gap-2">
                {editingGift ? "Сохранить изменения" : "Создать подарок"}
              </Button>
              <Button variant="outline" onClick={handleCancel}>Отмена</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search and filters */}
      {gifts && gifts.length > 0 && !showForm && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск подарков..."
              className="pl-9"
            />
          </div>
          {categories.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setFilterCategory("all")}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filterCategory === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Все
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    filterCategory === cat
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Gift grid */}
      {gifts && gifts.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/10 flex items-center justify-center mx-auto mb-5">
              <Gift className="w-7 h-7 text-violet-500/60" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Каталог пуст</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6 leading-relaxed">
              Создайте первый подарок, чтобы пользователи могли отправлять друг друга подарки на gomo6.
            </p>
            <Button onClick={() => { setForm(defaultForm); setShowForm(true); }} className="gap-2">
              <Plus className="w-4 h-4" />
              Создать подарок
            </Button>
          </CardContent>
        </Card>
      )}

      {filteredGifts && filteredGifts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredGifts.map((gift) => (
            <Card
              key={gift.id}
              className={`group hover:shadow-md transition-all duration-200 ${
                !gift.is_active ? "opacity-50" : ""
              }`}
            >
              <CardContent className="p-0">
                {/* Image */}
                <div className="aspect-[4/3] bg-muted rounded-t-lg overflow-hidden relative">
                  {gift.image_url ? (
                    <img
                      src={gift.image_url}
                      alt={gift.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Gift className="w-10 h-10 text-muted-foreground/40" />
                    </div>
                  )}
                  {/* Overlay badges */}
                  <div className="absolute top-2 left-2 flex gap-1.5">
                    {gift.is_limited && (
                      <Badge className="bg-amber-500/90 text-white border-0 text-[10px]">
                        Limited
                      </Badge>
                    )}
                    {!gift.is_active && (
                      <Badge className="bg-muted/90 text-muted-foreground border-0 text-[10px]">
                        Неактивен
                      </Badge>
                    )}
                  </div>
                  {/* Price badge */}
                  <div className="absolute bottom-2 right-2">
                    <Badge className="bg-background/90 backdrop-blur text-foreground border-0 text-xs font-semibold">
                      {gift.price} г
                    </Badge>
                  </div>
                </div>

                {/* Info */}
                <div className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm truncate">{gift.name}</h3>
                      {gift.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {gift.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] ${categoryColors[gift.category] || ""}`}
                    >
                      {gift.category}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      Продано: {gift.sold_count}
                    </span>
                    {gift.is_limited && gift.max_quantity && (
                      <span className="text-[10px] text-muted-foreground">
                        Осталось: {gift.max_quantity - gift.sold_count}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1.5 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(gift)}
                      className="flex-1 gap-1.5 h-8 text-xs"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      Изменить
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(gift.id)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {filteredGifts && filteredGifts.length === 0 && gifts && gifts.length > 0 && (
        <div className="text-center py-12">
          <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Ничего не найдено</p>
        </div>
      )}
    </div>
  );
};

export default GiftAdmin;
