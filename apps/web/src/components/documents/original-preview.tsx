'use client';

import { useEffect, useState } from 'react';

import { isAbortError } from '../../lib/datasets/client';
import {
  inboxBlobDownloadPath,
  inboxBlobInlinePath,
} from '../../lib/inbox/client';
import { isInlineMediaType } from '../../lib/inbox/contract.ts';
import styles from './original-preview.module.scss';

// The inline text preview never fetches more than this; a larger text file shows nothing inline.
const MAX_INLINE_TEXT_BYTES = 64 * 1024;

function isInlineText(mediaType: string): boolean {
  return mediaType.startsWith('text/') || mediaType === 'application/csv';
}

// A stored original as both the documents and the inbox pages know it.
type PreviewFile = Readonly<{
  blobId: string;
  byteSize: number;
  mediaType: string;
  name: string | null;
}>;

// The original preview (PDF frame, image or small text) from the shared blob route; callers gate scan status first.
export default function OriginalPreview({
  file,
  frameTitle,
  noPreviewLabel,
  organizationId,
}: Readonly<{
  file: PreviewFile;
  frameTitle: string;
  noPreviewLabel: string;
  organizationId: string;
}>) {
  const { blobId, byteSize, mediaType } = file;
  const [preview, setPreview] =
    useState<Readonly<{ blobId: string; text: string }>>();

  // Keyed on the primitives, so a caller building the file object per render never refetches.
  useEffect(() => {
    if (
      organizationId.length === 0 ||
      !isInlineText(mediaType) ||
      byteSize > MAX_INLINE_TEXT_BYTES
    ) {
      return;
    }

    const controller = new AbortController();
    // Text reads the download route (inline serves only pdf and images) into a React <pre>.
    void fetch(inboxBlobDownloadPath(organizationId, blobId), {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) => {
        setPreview({ blobId, text: text.slice(0, MAX_INLINE_TEXT_BYTES) });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setPreview(undefined);
        }
      });
    return () => {
      controller.abort();
    };
  }, [blobId, byteSize, mediaType, organizationId]);

  if (file.mediaType === 'application/pdf') {
    return (
      <iframe
        className={styles.preview!}
        // A sandboxed frame disables plugins, and Chromium's PDF viewer is one, so a PDF frame is not sandboxed.
        src={inboxBlobInlinePath(organizationId, file.blobId)}
        title={frameTitle}
      />
    );
  }
  if (isInlineMediaType(file.mediaType)) {
    return (
      // The original is a scanned blob, not a Next asset, so the raw <img> is correct here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={file.name ?? frameTitle}
        className={styles.previewImage!}
        src={inboxBlobInlinePath(organizationId, file.blobId)}
      />
    );
  }
  if (isInlineText(file.mediaType) && file.byteSize <= MAX_INLINE_TEXT_BYTES) {
    const text = preview?.blobId === file.blobId ? preview.text : '';
    return <pre className={styles.previewText!}>{text}</pre>;
  }
  return <p>{noPreviewLabel}</p>;
}
