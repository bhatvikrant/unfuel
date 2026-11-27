import { Camera, ImagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PHOTO_MAX_COUNT } from "@convex/lib/fuelRead";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOffline } from "@/lib/convex";
import { cn } from "@/lib/utils";

/** Thumbnails that open full size. `onRemove` puts a cross on each (a photo not saved yet). */
export function PhotoStrip({ urls, onRemove, className }: { urls: string[]; onRemove?: (i: number) => void; className?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!urls.length) return null;
  return (
    <>
      <ul className={cn("flex flex-wrap gap-2", className)}>
        {urls.map((url, i) => (
          <li key={url} className="relative">
            <button type="button" onClick={() => setOpen(url)} className="block size-20 overflow-hidden rounded-lg border bg-muted" aria-label={`Photo ${i + 1}, open full size`}>
              <img src={url} alt="" className="size-full object-cover" />
            </button>
            {onRemove ? (
              <button type="button" onClick={() => onRemove(i)} aria-label={`Remove photo ${i + 1}`} className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border bg-background shadow-card">
                <X className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-[min(96vw,48rem)] p-2">
          <DialogTitle className="sr-only">Photo</DialogTitle>
          <DialogDescription className="sr-only">The photo at full size.</DialogDescription>
          {open ? <img src={open} alt="The photo at full size" className="max-h-[80dvh] w-full rounded-md object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Two ways to add photos: the camera, and the gallery (several at once). Hidden file inputs: no camera permission of our own. */
export function PhotoButtons({ count, onFiles, busy }: { count: number; onFiles: (files: File[]) => void; busy?: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const full = count >= PHOTO_MAX_COUNT;
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = ""; // the same photo can be picked again after it is removed
    if (files.length) onFiles(files);
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={take} data-testid="camera-input" />
      <input ref={gallery} type="file" accept="image/*" multiple className="hidden" onChange={take} data-testid="gallery-input" />
      <Button type="button" size="lg" className="h-12 gap-2" disabled={full || busy} onClick={() => camera.current?.click()}><Camera className="size-5" />{count ? "Take another" : "Take photo"}</Button>
      <Button type="button" size="lg" variant="outline" className="h-12 gap-2" disabled={full || busy} onClick={() => gallery.current?.click()}><ImagePlus className="size-5" />From gallery</Button>
    </div>
  );
}

/** Addresses for photos still waiting on this device (a fill-up made offline), from the offline store. */
export function useLocalPhotos(keys: string[] | undefined): string[] {
  const { store } = useOffline();
  const [urls, setUrls] = useState<string[]>([]);
  const id = (keys ?? []).join(",");
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    void Promise.all((keys ?? []).map((k) => store.getBlob(k))).then((blobs) => {
      for (const b of blobs) if (b) made.push(URL.createObjectURL(b));
      if (alive) setUrls(made);
      else made.forEach((u) => URL.revokeObjectURL(u));
    });
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, store]);
  return urls;
}
