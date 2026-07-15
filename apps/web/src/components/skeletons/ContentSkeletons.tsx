import { Skeleton } from "@/components/ui/skeleton";

export function ThreadCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <Skeleton className="h-5 w-3/4" />
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      <div className="flex gap-4 pt-1">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3.5 w-16" />
      </div>
    </div>
  );
}

export function ThreadFeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <ThreadCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 sm:gap-4">
          <Skeleton className="w-14 h-14 sm:w-20 sm:h-20 rounded-full shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-6 sm:h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-8 w-8 rounded-md shrink-0" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4 bg-post-header border border-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 sm:h-7 w-12" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="border-b border-border">
        <div className="flex gap-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 px-6 shrink-0" />
          ))}
        </div>
      </div>
    </div>
  );
}
