import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PentagramLoader } from "@/components/PentagramLoader";
import { Plus, Trash2, Edit2, Gift, X } from "lucide-react";
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

const GiftAdmin = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingGift, setEditingGift] = useState<GiftItem | null>(null);
  const [form, setForm] = useState<GiftForm>(defaultForm);

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

  if (!sessionChecked || isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <PentagramLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gift className="w-6 h-6" />
            Управление подарками
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Создавайте и редактируйте каталог подарков
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditingGift(null); setForm(defaultForm); setShowForm(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            Добавить подарок
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-8">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{editingGift ? "Редактировать подарок" : "Новый подарок"}</CardTitle>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Название *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Название подарка"
                />
              </div>
              <div>
                <Label htmlFor="image_url">URL изображения *</Label>
                <Input
                  id="image_url"
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  placeholder="path/to/image.png"
                />
              </div>
              <div>
                <Label htmlFor="price">Цена (gарма) *</Label>
                <Input
                  id="price"
                  type="number"
                  min={1}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <Label htmlFor="category">Категория</Label>
                <Input
                  id="category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="general"
                />
              </div>
              <div>
                <Label htmlFor="sort_order">Порядок сортировки</Label>
                <Input
                  id="sort_order"
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                />
              </div>
              {form.is_limited && (
                <div>
                  <Label htmlFor="max_quantity">Макс. количество</Label>
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
            <div>
              <Label htmlFor="description">Описание</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Описание подарка"
                rows={2}
              />
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                <Label htmlFor="is_active">Активен</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="is_limited"
                  checked={form.is_limited}
                  onCheckedChange={(v) => setForm({ ...form, is_limited: v })}
                />
                <Label htmlFor="is_limited">Лимитированный</Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                {editingGift ? "Сохранить" : "Создать"}
              </Button>
              <Button variant="outline" onClick={handleCancel}>Отмена</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {gifts && gifts.length === 0 && (
          <p className="text-center text-muted-foreground py-12">Подарков пока нет. Создайте первый!</p>
        )}
        {gifts?.map((gift) => (
          <Card key={gift.id} className={!gift.is_active ? "opacity-50" : ""}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                {gift.image_url ? (
                  <img src={gift.image_url} alt={gift.name} className="w-full h-full object-cover" />
                ) : (
                  <Gift className="w-6 h-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{gift.name}</p>
                  {!gift.is_active && <Badge variant="secondary">Неактивен</Badge>}
                  {gift.is_limited && <Badge variant="outline">Лимит {gift.max_quantity}</Badge>}
                  <Badge variant="secondary">{gift.category}</Badge>
                </div>
                {gift.description && (
                  <p className="text-sm text-muted-foreground truncate">{gift.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {gift.price} gарм · Продано: {gift.sold_count} · Порядок: {gift.sort_order}
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Button variant="ghost" size="sm" onClick={() => handleEdit(gift)}>
                  <Edit2 className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(gift.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default GiftAdmin;
