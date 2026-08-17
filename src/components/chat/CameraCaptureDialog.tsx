'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Camera,
  ImageUp,
  Loader2,
  RefreshCw,
  RotateCcw,
  SendHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

type FacingMode = 'user' | 'environment';

interface CameraCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bound to the composer draft so a caption typed here rides along with the photo. */
  caption: string;
  onCaptionChange: (value: string) => void;
  /** Resolves true once the photo is stored; false keeps the shot on screen to retry. */
  onSend: (file: File) => Promise<boolean>;
  uploadProgress: number | null;
}

export function CameraCaptureDialog({
  open,
  onOpenChange,
  caption,
  onCaptionChange,
  onSend,
  uploadProgress,
}: CameraCaptureDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const isUploading = uploadProgress !== null;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // The live stream is only needed while framing the shot: once a still exists we
  // release the camera so the indicator light goes out and the preview is stable.
  useEffect(() => {
    if (!open || capturedFile) {
      stopStream();
      return;
    }

    let cancelled = false;
    setCameraError(null);
    setIsStartingCamera(true);

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('unsupported');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        // Only offer the flip control when there is somewhere to flip to.
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) {
          setHasMultipleCameras(
            devices.filter((device) => device.kind === 'videoinput').length > 1
          );
        }
      } catch (error) {
        if (cancelled) return;
        setCameraError(describeCameraError(error));
      } finally {
        if (!cancelled) setIsStartingCamera(false);
      }
    };

    void startCamera();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [capturedFile, facingMode, open, stopStream]);

  // Each new preview replaces the previous blob URL; releasing it here also covers
  // the dialog unmounting mid-preview.
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const acceptPhoto = (file: File) => {
    setCapturedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setSendError(null);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('This device could not process the photo. Pick an image instead.');
      return;
    }
    // The selfie preview is mirrored the way people expect to see themselves, so
    // mirror the frame too — otherwise the sent photo is flipped from the preview.
    if (facingMode === 'user') {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError('The photo could not be captured. Please try again.');
          return;
        }
        acceptPhoto(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.9
    );
  };

  const handleFallbackFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) acceptPhoto(file);
  };

  const retake = () => {
    setCapturedFile(null);
    setPreviewUrl(null);
    setSendError(null);
  };

  const closeAndReset = () => {
    onOpenChange(false);
    setCapturedFile(null);
    setPreviewUrl(null);
    setCameraError(null);
    setSendError(null);
    setFacingMode('environment');
  };

  const sendPhoto = async () => {
    if (!capturedFile || isUploading) return;
    setSendError(null);
    const sent = await onSend(capturedFile);
    if (sent) {
      // Closing directly rather than through the dismiss handler: the upload has
      // finished, but this closure still sees the pre-reset `uploadProgress`, and
      // the dismiss guard would read that as an upload in flight.
      closeAndReset();
      return;
    }
    setSendError('The photo was not sent. Check your connection and try again.');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    // Don't let a backdrop click or Escape discard a photo that is mid-upload.
    if (isUploading) return;
    closeAndReset();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="default" className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Take a photo</DialogTitle>
          <DialogDescription>
            {capturedFile
              ? 'Add a caption, then send it to this chat.'
              : 'Frame your shot and tap the shutter.'}
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-[4/3] w-full overflow-hidden bg-black">
          {capturedFile && previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, not an optimizable asset
            <img src={previewUrl} alt="Captured photo preview" className="h-full w-full object-contain" />
          ) : cameraError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
              <div className="rounded-full bg-white/10 p-3">
                <Camera className="h-6 w-6 text-white/80" />
              </div>
              <p className="text-sm text-white/85">{cameraError}</p>
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                <ImageUp className="mr-2 h-4 w-4" /> Choose a photo
              </Button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                muted
                autoPlay
                playsInline
                className={cn(
                  'h-full w-full object-cover',
                  facingMode === 'user' && 'scale-x-[-1]'
                )}
              />
              {isStartingCamera && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-3 px-5 py-4">
          {isUploading && (
            <div className="rounded-xl border bg-muted/50 px-3 py-2">
              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                <span>Sending photo…</span>
                <span>{Math.round(uploadProgress ?? 0)}%</span>
              </div>
              <Progress value={uploadProgress ?? 0} className="h-1.5" />
            </div>
          )}

          {sendError && <p className="text-xs font-medium text-destructive">{sendError}</p>}

          {capturedFile ? (
            <>
              <Input
                value={caption}
                onChange={(event) => onCaptionChange(event.target.value)}
                placeholder="Add a caption (optional)"
                disabled={isUploading}
              />
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={retake} disabled={isUploading}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Retake
                </Button>
                <Button onClick={() => void sendPhoto()} disabled={isUploading}>
                  {isUploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <SendHorizontal className="mr-2 h-4 w-4" />
                  )}
                  Send photo
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-xl"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Choose a photo from this device"
              >
                <ImageUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                className="h-14 w-14 rounded-full"
                onClick={capturePhoto}
                disabled={Boolean(cameraError) || isStartingCamera}
                aria-label="Capture photo"
              >
                <Camera className="h-6 w-6" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-10 w-10 rounded-xl', !hasMultipleCameras && 'invisible')}
                onClick={() => setFacingMode((current) => (current === 'user' ? 'environment' : 'user'))}
                disabled={Boolean(cameraError) || isStartingCamera}
                aria-label="Switch camera"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFallbackFile}
        />
      </DialogContent>
    </Dialog>
  );
}

function describeCameraError(error: unknown) {
  if (error instanceof Error && error.message === 'unsupported') {
    return 'This device does not give the app a camera. Choose a photo instead.';
  }
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow the camera in your settings, or choose a photo instead.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device. Choose a photo instead.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is in use by another app. Close it and try again.';
  }
  return 'The camera could not be started. Choose a photo instead.';
}
