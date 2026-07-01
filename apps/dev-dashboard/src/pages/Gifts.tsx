import { useState, useEffect, useCallback, useRef } from "react";
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
  Plus, Trash2, Gift, X, Upload, Sparkles, ImageIcon, Search,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GiftLayerItem {
  id: string;
  gift_catalog_id: string;
  layer_type: "gift" | "background" | "symbol";
  image_url: string;
  name?: string;
  sort_order: number;
  usage_count?: number;
}

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
  is_upgradable: boolean;
  upgrade_cost?: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LAYER_TYPES = ["gift", "background", "symbol"] as const;
const LAYER_LABELS: Record<string, string> = { gift: "Подарок", background: "Фон", symbol: "Символ" };
const LAYER_ICONS: Record<string, string> = { gift: "🎁", background: "🖼️", symbol: "✨" };

function storageUrl(url: string) {
  if (url.startsWith("http")) return url;
  return `/storage/v1/object/gift-layers/${url}`;
}

async function uploadFile(file: File, bucket: string, key: string): Promise<string> {
  const token = api.getToken();
  if (!token) throw new Error("Not authenticated");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", bucket);
  formData.append("key", key);

  const res = await fetch("/storage/v1/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Upload failed");
  return key;
}

// ─── Component ───────────────────────────────────────────────────────────────

const GiftAdmin = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Create/edit form state ──
  const [showForm, setShowForm] = useState(false);
  const [editingGift, setEditingGift] = useState<GiftItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPrice, setFormPrice] = useState(10);
  const [formCategory, setFormCategory] = useState("general");
  const [formActive, setFormActive] = useState(true);
  const [formLimited, setFormLimited] = useState(false);
  const [formMaxQty, setFormMaxQty] = useState(0);
  const [formSort, setFormSort] = useState(0);
  const [formUpgradable, setFormUpgradable] = useState(false);
  const [formUpgradeCost, setFormUpgradeCost] = useState(20);
  const [formImageUrl, setFormImageUrl] = useState("");
  const [baseImageFile, setBaseImageFile] = useState<File | null>(null);
  const [baseImagePreview, setBaseImagePreview] = useState("");
  const [uploadingBase, setUploadingBase] = useState(false);

  // ── Layer upload state ──
  const [activeLayerTab, setActiveLayerTab] = useState<string>("gift");
  const [dragOverLayer, setDragOverLayer] = useState(false);
  const [uploadingLayer, setUploadingLayer] = useState(false);
  const layerInputRef = useRef<HTMLInputElement>(null);

  // ── Drag & drop for base image ──
  const [dragOverBase, setDragOverBase] = useState(false);

  useEffect(() => {
    api.getSession().then(({ session }) => {
      if (!session) navigate("/login?redirect=/gifts");
      setSessionChecked(true);
    });
  }, []);

  const basePreviewRef = useRef("");
  basePreviewRef.current = baseImagePreview;

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (basePreviewRef.current) URL.revokeObjectURL(basePreviewRef.current);
    };
  }, []);

  // ── Queries ──

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

  const { data: layers, isLoading: layersLoading } = useQuery({
    queryKey: ["admin-gift-layers", selectedGift?.id],
    queryFn: async () => {
      if (!selectedGift) return [];
      const res = await api.fetch(`/api/v1/admin/gifts/${selectedGift.id}/layers`);
      if (!res.ok) throw new Error("Failed to fetch layers");
      const json = await res.json();
      return json.data as GiftLayerItem[];
    },
    enabled: !!selectedGift,
  });

  // ── Mutations ──

  const createGift = useMutation({
    mutationFn: async () => {
      // Build imageUrl — use file only if actually selecting a file (upload after create)
      let imageUrl = formImageUrl.trim();
      const hasNewFile = baseImageFile && !imageUrl;

      if (!formName.trim() || (!imageUrl && !hasNewFile) || formPrice <= 0) {
        throw new Error("Заполните название, картинку и цену");
      }

      // If no URL but have a file, use a placeholder; upload after getting ID back
      if (hasNewFile) imageUrl = "pending";

      const res = await api.fetch("/api/v1/admin/gifts", {
        method: "POST",
        body: JSON.stringify({
          name: formName,
          description: formDesc || null,
          image_url: imageUrl,
          price: formPrice,
          category: formCategory,
          is_active: formActive,
          is_limited: formLimited,
          max_quantity: formLimited ? formMaxQty : null,
          sort_order: formSort,
          is_upgradable: formUpgradable,
          upgrade_cost: formUpgradable ? formUpgradeCost : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create");
      const gift = json.data as GiftItem;

      // Upload base image with proper key AFTER getting the gift ID
      if (baseImageFile) {
        try {
          const ext = baseImageFile.name.split(".").pop() || "png";
          const key = `gifts/${gift.id}/base.${ext}`;
          await uploadFile(baseImageFile, "gift-layers", key);
          await api.fetch(`/api/v1/admin/gifts/${gift.id}`, {
            method: "PUT",
            body: JSON.stringify({ image_url: key }),
          });
          gift.image_url = key;
        } catch (err: any) {
          toast.error(`Картинка не загрузилась: ${err.message}`);
        }
      }

      return gift;
    },
    onSuccess: (gift) => {
      queryClient.invalidateQueries({ queryKey: ["admin-gifts"] });
      toast.success("Подарок создан");
      resetForm();
      setSelectedGift(gift);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateGift = useMutation({
    mutationFn: async () => {
      if (!editingGift) return;
      let imageUrl = formImageUrl.trim();

      if (baseImageFile) {
        setUploadingBase(true);
        try {
          const ext = baseImageFile.name.split(".").pop() || "png";
          const key = `gifts/${editingGift.id}/base.${ext}`;
          await uploadFile(baseImageFile, "gift-layers", key);
          imageUrl = key;
        } finally {
          setUploadingBase(false);
        }
      }

      const res = await api.fetch(`/api/v1/admin/gifts/${editingGift.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: formName,
          description: formDesc || null,
          image_url: imageUrl,
          price: formPrice,
          category: formCategory,
          is_active: formActive,
          is_limited: formLimited,
          max_quantity: formLimited ? formMaxQty : null,
          sort_order: formSort,
          is_upgradable: formUpgradable,
          upgrade_cost: formUpgradable ? formUpgradeCost : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-gifts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-gift-layers", selectedGift?.id] });
      toast.success("Подарок обновлён");
      resetForm();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteGift = useMutation({
    mutationFn: async (id: string) => {
      await api.fetch(`/api/v1/admin/gifts/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-gifts"] });
      toast.success("Подарок деактивирован");
      if (selectedGift) setSelectedGift(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteLayer = useMutation({
    mutationFn: async (layerId: string) => {
      if (!selectedGift) return;
      await api.fetch(`/api/v1/admin/gifts/${selectedGift.id}/layers/${layerId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-gift-layers", selectedGift?.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-gifts"] });
      toast.success("Слой удалён");
    },
    onError: (err: any) => toast.error(err.message),
  });

  // ── Layer upload ──

  const doLayerUpload = useCallback(async (files: FileList | File[]) => {
    if (!selectedGift || uploadingLayer) return;
    setUploadingLayer(true);
    const fileArray = Array.from(files).filter(f => f.type === "image/png");

    if (fileArray.length === 0) {
      toast.error("Только PNG файлы");
      setUploadingLayer(false);
      return;
    }

    let successCount = 0;
    for (const file of fileArray) {
      try {
        const key = `gifts/${selectedGift.id}/layers/${activeLayerTab}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
        await uploadFile(file, "gift-layers", key);

        const layerRes = await api.fetch(`/api/v1/admin/gifts/${selectedGift.id}/layers`, {
          method: "POST",
          body: JSON.stringify({
            layer_type: activeLayerTab,
            image_url: key,
            name: file.name.replace(/\.[^.]+$/, ""),
          }),
        });
        if (layerRes.ok) successCount++;
      } catch (err: any) {
        toast.error(`Ошибка: ${err.message}`);
      }
    }

    if (successCount > 0) {
      queryClient.invalidateQueries({ queryKey: ["admin-gift-layers", selectedGift.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-gifts"] });
      toast.success(`Загружено ${successCount} слоёв`);
    }
    setUploadingLayer(false);
  }, [selectedGift, activeLayerTab, uploadingLayer, queryClient]);

  // ── Base image drop ──

  const handleBaseImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverBase(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === "image/png") {
      if (baseImagePreview) URL.revokeObjectURL(baseImagePreview);
      setBaseImageFile(file);
      setBaseImagePreview(URL.createObjectURL(file));
    } else {
      toast.error("Только PNG");
    }
  }, [baseImagePreview]);

  // ── Layer drop zone ──

  const handleLayerDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverLayer(false);
    doLayerUpload(e.dataTransfer.files);
  }, [doLayerUpload]);

  const openLayerFilePicker = useCallback(() => {
    layerInputRef.current?.click();
  }, []);

  // ── Form helpers ──

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (gift: GiftItem) => {
    setEditingGift(gift);
    setFormName(gift.name);
    setFormDesc(gift.description || "");
    setFormImageUrl(gift.image_url);
    setFormPrice(gift.price);
    setFormCategory(gift.category);
    setFormActive(gift.is_active);
    setFormLimited(gift.is_limited);
    setFormMaxQty(gift.max_quantity || 0);
    setFormSort(gift.sort_order);
    setFormUpgradable(gift.is_upgradable);
    setFormUpgradeCost(gift.upgrade_cost || 20);
    setBaseImageFile(null);
    if (baseImagePreview) { URL.revokeObjectURL(baseImagePreview); }
    setBaseImagePreview("");
    setShowForm(true);
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingGift(null);
    setFormName("");
    setFormDesc("");
    setFormImageUrl("");
    setFormPrice(10);
    setFormCategory("general");
    setFormActive(true);
    setFormLimited(false);
    setFormMaxQty(0);
    setFormSort(0);
    setFormUpgradable(false);
    setFormUpgradeCost(20);
    setBaseImageFile(null);
    if (baseImagePreview) { URL.revokeObjectURL(baseImagePreview); }
    setBaseImagePreview("");
  };

  const handleSubmit = () => {
    if (editingGift) updateGift.mutate();
    else createGift.mutate();
  };

  // ── Derived data ──

  const layersByType = {
    gift: layers?.filter(l => l.layer_type === "gift") || [],
    background: layers?.filter(l => l.layer_type === "background") || [],
    symbol: layers?.filter(l => l.layer_type === "symbol") || [],
  };

  const hasAllLayers = LAYER_TYPES.every(t => layersByType[t].length > 0);
  const layersTotal = (layersByType.gift.length + layersByType.background.length + layersByType.symbol.length);

  const activeGifts = gifts?.filter(g => g.is_active).length || 0;
  const totalSold = gifts?.reduce((s, g) => s + g.sold_count, 0) || 0;

  const filteredGifts = gifts?.filter(g => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return g.name.toLowerCase().includes(q) || (g.description || "").toLowerCase().includes(q);
  });

  if (!sessionChecked || isLoading) {
    return <div className="flex items-center justify-center py-20"><PentagramLoader size="lg" /></div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Подарки</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {gifts?.length || 0} всего · {activeGifts} активных · продано {totalSold}
          </p>
        </div>
        <Button onClick={openCreateForm} className="gap-2" disabled={showForm}>
          <Plus className="w-4 h-4" /> Создать подарок
        </Button>
      </div>

      {/* ── Two-panel layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Gift list with search */}
        <div className="lg:col-span-1 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Каталог</h2>

          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск..."
              className="pl-9"
            />
          </div>

          {!filteredGifts || filteredGifts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Gift className="w-8 h-8 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? "Ничего не найдено" : "Нет подарков"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {filteredGifts.map(gift => (
                <button
                  key={gift.id}
                  onClick={() => setSelectedGift(gift)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-3 ${
                    selectedGift?.id === gift.id
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:bg-muted/50"
                  } ${!gift.is_active ? "opacity-50" : ""}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                    {gift.image_url && gift.image_url !== "pending" ? (
                      <img src={storageUrl(gift.image_url)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Gift className="w-4 h-4 text-muted-foreground" /></div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{gift.name}</p>
                    <p className="text-xs text-muted-foreground">{gift.price} дропсов · {gift.category}</p>
                  </div>
                  {gift.is_upgradable && (
                    <Sparkles className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Selected gift detail + layers */}
        <div className="lg:col-span-2 space-y-6">
          {!selectedGift ? (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <Gift className="w-10 h-10 mx-auto text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">Выберите подарок слева или создайте новый</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Gift info card */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex gap-4">
                    <div className="w-24 h-24 rounded-xl bg-muted overflow-hidden flex-shrink-0 border">
                      {selectedGift.image_url && selectedGift.image_url !== "pending" ? (
                        <img src={storageUrl(selectedGift.image_url)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Gift className="w-8 h-8 text-muted-foreground" /></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-bold">{selectedGift.name}</h3>
                          {selectedGift.description && (
                            <p className="text-sm text-muted-foreground mt-0.5">{selectedGift.description}</p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEditForm(selectedGift)}>Изменить</Button>
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteGift.mutate(selectedGift.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Badge variant="secondary">{selectedGift.price} дропсов</Badge>
                        <Badge variant="outline">{selectedGift.category}</Badge>
                        {!selectedGift.is_active && <Badge variant="destructive" className="text-xs">Неактивен</Badge>}
                        {selectedGift.is_upgradable && (
                          <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                            <Sparkles className="w-3 h-3 mr-1" /> Улучшаемый · {selectedGift.upgrade_cost} дропсов
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">Продано: {selectedGift.sold_count}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Layers section */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Слои улучшения</CardTitle>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{layersTotal} слоёв</span>
                      {selectedGift.is_upgradable
                        ? <Badge className="bg-emerald-500/10 text-emerald-600 border-0 text-xs">Активно</Badge>
                        : <Badge variant="outline" className="text-xs">Нужно заполнить</Badge>
                      }
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Layer type tabs */}
                  <div className="flex gap-1 bg-muted rounded-lg p-1">
                    {LAYER_TYPES.map(t => (
                      <button
                        key={t}
                        onClick={() => setActiveLayerTab(t)}
                        className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
                          activeLayerTab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {LAYER_ICONS[t]} {LAYER_LABELS[t]}
                        <span className="ml-1 text-muted-foreground">({layersByType[t].length})</span>
                      </button>
                    ))}
                  </div>

                  {/* Hidden file input for layers */}
                  <input
                    ref={layerInputRef}
                    type="file"
                    accept="image/png"
                    multiple
                    className="hidden"
                    onChange={e => {
                      if (e.target.files) doLayerUpload(e.target.files);
                      e.target.value = "";
                    }}
                  />

                  {/* Drop zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOverLayer(true); }}
                    onDragLeave={() => setDragOverLayer(false)}
                    onDrop={handleLayerDrop}
                    onClick={openLayerFilePicker}
                    className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
                      dragOverLayer ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-muted-foreground/40"
                    }`}
                  >
                    {uploadingLayer ? (
                      <div className="flex flex-col items-center gap-2">
                        <PentagramLoader size="sm" />
                        <p className="text-xs text-muted-foreground">Загрузка...</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="w-6 h-6 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                          Перетащите PNG или нажмите для выбора
                        </p>
                        <p className="text-[10px] text-muted-foreground/60">
                          Тип: {LAYER_LABELS[activeLayerTab]} · можно несколько файлов
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Layer grid — current tab */}
                  {layersLoading ? (
                    <div className="flex justify-center py-4"><PentagramLoader size="sm" /></div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium">{LAYER_ICONS[activeLayerTab]} {LAYER_LABELS[activeLayerTab]}</span>
                        {layersByType[activeLayerTab].length === 0 && (
                          <span className="text-[10px] text-red-500">— нужно добавить</span>
                        )}
                      </div>
                      {layersByType[activeLayerTab].length === 0 ? (
                        <div className="grid grid-cols-4 gap-2">
                          {[1, 2, 3, 4].map(i => (
                            <div key={i} className="aspect-square rounded-lg border border-dashed border-muted-foreground/20 bg-muted/30" />
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                          {layersByType[activeLayerTab].map(layer => (
                            <div key={layer.id} className="group relative aspect-square rounded-lg bg-muted overflow-hidden border border-border hover:border-primary/50 transition-colors">
                              <img src={storageUrl(layer.image_url)} alt="" className="w-full h-full object-cover" />
                              <button
                                onClick={() => deleteLayer.mutate(layer.id)}
                                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-destructive/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-3 h-3" />
                              </button>
                              {layer.usage_count ? (
                                <div className="absolute bottom-0 left-0 right-0 bg-background/80 text-center text-[9px] py-px">×{layer.usage_count}</div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Status footer */}
                  <div className="flex items-center gap-2 pt-2 border-t">
                    <div className="flex gap-1">
                      {LAYER_TYPES.map(t => (
                        <div key={t} className={`w-2 h-2 rounded-full ${layersByType[t].length > 0 ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {hasAllLayers ? "Все типы заполнены — улучшения активны" : "Добавьте все 3 типа слоёв для активации"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* ── Create / Edit modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-background/80 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) resetForm(); }}>
          <Card className="w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{editingGift ? "Редактировать" : "Новый подарок"}</CardTitle>
              <Button variant="ghost" size="sm" onClick={resetForm}><X className="w-4 h-4" /></Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Base image — drag & drop */}
              <div>
                <Label className="text-sm mb-2 block">Картинка *</Label>
                <div
                  onDragOver={e => { e.preventDefault(); setDragOverBase(true); }}
                  onDragLeave={() => setDragOverBase(false)}
                  onDrop={handleBaseImageDrop}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/png";
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) {
                        if (baseImagePreview) URL.revokeObjectURL(baseImagePreview);
                        setBaseImageFile(file);
                        setBaseImagePreview(URL.createObjectURL(file));
                      }
                    };
                    input.click();
                  }}
                  className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                    dragOverBase ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-muted-foreground/40"
                  }`}
                >
                  {baseImagePreview ? (
                    <img src={baseImagePreview} alt="preview" className="max-h-32 mx-auto rounded-lg" />
                  ) : formImageUrl && formImageUrl !== "pending" ? (
                    <img src={storageUrl(formImageUrl)} alt="current" className="max-h-32 mx-auto rounded-lg" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-6">
                      <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">Перетащите PNG или нажмите</p>
                    </div>
                  )}
                </div>
                <Input
                  value={formImageUrl}
                  onChange={e => { setFormImageUrl(e.target.value); setBaseImageFile(null); if (baseImagePreview) { URL.revokeObjectURL(baseImagePreview); setBaseImagePreview(""); } }}
                  placeholder="Или вставьте URL/путь"
                  className="mt-2 text-xs"
                />
              </div>

              {/* Name + Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Название *</Label>
                  <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Название" className="mt-1" />
                </div>
                <div>
                  <Label className="text-sm">Категория</Label>
                  <Input value={formCategory} onChange={e => setFormCategory(e.target.value)} placeholder="general" className="mt-1" />
                </div>
              </div>

              {/* Price + Sort */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Цена (дропсы) *</Label>
                  <Input type="number" min={1} value={formPrice} onChange={e => setFormPrice(parseInt(e.target.value) || 0)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-sm">Порядок</Label>
                  <Input type="number" value={formSort} onChange={e => setFormSort(parseInt(e.target.value) || 0)} className="mt-1" />
                </div>
              </div>

              {/* Description */}
              <div>
                <Label className="text-sm">Описание</Label>
                <Textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Описание..." rows={2} className="mt-1" />
              </div>

              {/* Toggles */}
              <div className="flex flex-wrap gap-4 items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch checked={formActive} onCheckedChange={setFormActive} />
                  <span className="text-sm">Активен</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch checked={formLimited} onCheckedChange={setFormLimited} />
                  <span className="text-sm">Лимит</span>
                </label>
                {formLimited && (
                  <Input type="number" min={1} value={formMaxQty} onChange={e => setFormMaxQty(parseInt(e.target.value) || 0)} placeholder="Кол-во" className="w-20 h-8 text-xs" />
                )}
              </div>

              {/* Upgrade */}
              <div className="border-t pt-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch checked={formUpgradable} onCheckedChange={setFormUpgradable} />
                  <span className="text-sm font-medium flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Улучшаемый
                  </span>
                </label>
                {formUpgradable && (
                  <div className="w-48">
                    <Label className="text-xs text-muted-foreground">Стоимость улучшения (дропсы)</Label>
                    <Input type="number" min={1} value={formUpgradeCost} onChange={e => setFormUpgradeCost(parseInt(e.target.value) || 0)} className="mt-1" />
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSubmit} disabled={createGift.isPending || updateGift.isPending || uploadingBase} className="flex-1">
                  {uploadingBase ? "Загрузка..." : editingGift ? "Сохранить" : "Создать"}
                </Button>
                <Button variant="outline" onClick={resetForm}>Отмена</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default GiftAdmin;
