import { countReviewNoteIsValid } from '../../../lib/count-review';
import { useWorkspace } from '../WorkspaceContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';

export function ReviewVarianceDialog() {
  const {
    modalOpen, reviewCount, reviewReason, reviewingCount,
    setModalOpen, setReviewReason, submitLoading,
  } = useWorkspace();
  return (
    <Dialog open={modalOpen === 'reviewVariance'} onOpenChange={(open) => !open && setModalOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Stock Count Variance</DialogTitle>
          </DialogHeader>
          {reviewingCount && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Item</p>
                  <p className="font-medium">{reviewingCount.item}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Lot</p>
                  <p className="font-medium">{reviewingCount.lot}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Submitted by</p>
                  <p className="font-medium">{reviewingCount.user ?? 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Mode</p>
                  <Badge variant="outline">{reviewingCount.mode === 'scan' ? 'Scan' : 'Manual'}</Badge>
                </div>
              </div>

              <div className="rounded-lg border p-3">
                <p className="mb-2 font-medium">Variance Analysis</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Book Qty</p>
                    <p className="text-lg font-semibold">{reviewingCount.bookQuantity ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Physical Qty</p>
                    <p className="text-lg font-semibold">{reviewingCount.qty}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Variance</p>
                    <p className={`text-lg font-semibold ${Number(reviewingCount.variance ?? 0) < 0 ? 'text-destructive' : 'text-success'}`}>
                      {reviewingCount.variance ?? 0}
                    </p>
                  </div>
                </div>
              </div>

              {reviewingCount.toleranceRecommendation?.recommendRecount && (
                <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-medium text-amber-700 dark:text-amber-400">Recommended: request a recount</p>
                    <p className="text-xs text-muted-foreground">{reviewingCount.toleranceRecommendation.reason} This is a recommendation only - approve, recount or reject as you judge best.</p>
                  </div>
                </div>
              )}

              <div className="grid gap-2">
                <Label>Reason for decision</Label>
                <Textarea
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                  placeholder="Required. e.g., Damaged units discovered during recount, expired stock removed."
                />
                <p className="text-xs text-muted-foreground">At least 5 characters. Store users stay blind to book quantity.</p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  className="flex-1"
                  onClick={() => reviewCount(reviewingCount.id, 'APPROVED')}
                  disabled={submitLoading || !countReviewNoteIsValid(reviewReason)}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => reviewCount(reviewingCount.id, 'RECOUNT')}
                  disabled={submitLoading || !countReviewNoteIsValid(reviewReason)}
                >
                  Request recount
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => reviewCount(reviewingCount.id, 'REJECTED')}
                  disabled={submitLoading || !countReviewNoteIsValid(reviewReason)}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
  );
}
