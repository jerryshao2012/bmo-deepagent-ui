"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ThreadDocument {
  name: string;
  size: number;
  type?: string;
  [key: string]: unknown;
}

interface UseThreadDocumentAvailabilityOptions {
  threadId: string | null;
  listDocuments: (threadId: string) => Promise<Response>;
}

interface UploadSuccess {
  activeThreadId?: string;
  documents: ThreadDocument[];
}

export function useThreadDocumentAvailability({
  threadId,
  listDocuments,
}: UseThreadDocumentAvailabilityOptions) {
  const [documents, setDocuments] = useState<ThreadDocument[]>([]);
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [availabilityEvidence, setAvailabilityEvidence] = useState<{
    threadId: string;
    available: boolean;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const documentsRef = useRef<ThreadDocument[]>([]);
  const threadIdRef = useRef(threadId);
  const listDocumentsRef = useRef(listDocuments);
  const renderedThreadIdRef = useRef(threadId);
  const operationEpochRef = useRef(0);
  const mountedRef = useRef(true);

  threadIdRef.current = threadId;
  listDocumentsRef.current = listDocuments;
  if (renderedThreadIdRef.current !== threadId) {
    renderedThreadIdRef.current = threadId;
    operationEpochRef.current += 1;
  }

  const replaceDocuments = useCallback((nextDocuments: ThreadDocument[]) => {
    documentsRef.current = nextDocuments;
    setDocuments(nextDocuments);
  }, []);

  const isCurrent = useCallback(
    (targetThreadId: string, epoch: number, allowUnrendered = false) =>
      mountedRef.current &&
      operationEpochRef.current === epoch &&
      (threadIdRef.current === targetThreadId ||
        (allowUnrendered && threadIdRef.current === null)),
    []
  );

  const beginOperation = useCallback(() => {
    operationEpochRef.current += 1;
    return operationEpochRef.current;
  }, []);

  const refreshThread = useCallback(
    async (targetThreadId: string, epoch: number, allowUnrendered = false) => {
      if (isCurrent(targetThreadId, epoch, allowUnrendered)) {
        setIsRefreshing(true);
      }

      try {
        const response = await listDocumentsRef.current(targetThreadId);
        if (!isCurrent(targetThreadId, epoch, allowUnrendered)) return;

        let nextDocuments: ThreadDocument[];
        if (response.status === 404) {
          nextDocuments = [];
        } else {
          if (!response.ok) {
            setAvailability(null);
            return;
          }

          const body: unknown = await response.json();
          if (
            typeof body !== "object" ||
            body === null ||
            !("items" in body) ||
            !Array.isArray((body as { items: unknown }).items)
          ) {
            setAvailability(null);
            return;
          }

          nextDocuments = (body as { items: ThreadDocument[] }).items.filter(
            (item) => item?.type === "file"
          );
        }

        if (!isCurrent(targetThreadId, epoch, allowUnrendered)) return;
        const hasDocuments = nextDocuments.length > 0;
        replaceDocuments(nextDocuments);
        setAvailability(hasDocuments);
        setAvailabilityEvidence({
          threadId: targetThreadId,
          available: hasDocuments,
        });
      } catch {
        if (isCurrent(targetThreadId, epoch, allowUnrendered)) {
          setAvailability(null);
        }
      } finally {
        if (isCurrent(targetThreadId, epoch, allowUnrendered)) {
          setIsRefreshing(false);
        }
      }
    },
    [isCurrent, replaceDocuments]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationEpochRef.current += 1;
    };
  }, []);

  useEffect(() => {
    replaceDocuments([]);
    setAvailability(null);
    setAvailabilityEvidence(null);
    setIsRefreshing(false);

    if (!threadId) {
      return;
    }

    void refreshThread(threadId, beginOperation());
  }, [beginOperation, refreshThread, replaceDocuments, threadId]);

  const refresh = useCallback(
    async (activeThreadId?: string) => {
      const targetThreadId = activeThreadId ?? threadIdRef.current;
      if (!targetThreadId) return;
      const allowUnrendered = activeThreadId !== undefined;
      const currentThreadId = threadIdRef.current;
      if (
        currentThreadId !== targetThreadId &&
        !(allowUnrendered && currentThreadId === null)
      ) {
        return;
      }
      await refreshThread(targetThreadId, beginOperation(), allowUnrendered);
    },
    [beginOperation, refreshThread]
  );

  const recordUploadSuccess = useCallback(
    async ({ activeThreadId, documents: uploadedDocuments }: UploadSuccess) => {
      const targetThreadId = activeThreadId ?? threadIdRef.current;
      if (!targetThreadId) return false;

      const allowUnrendered = activeThreadId !== undefined;
      const currentThreadId = threadIdRef.current;
      if (
        currentThreadId !== targetThreadId &&
        !(allowUnrendered && currentThreadId === null)
      ) {
        return false;
      }

      const epoch = beginOperation();
      const canRender = isCurrent(targetThreadId, epoch, allowUnrendered);
      if (canRender) {
        const byName = new Map(
          documentsRef.current.map((document) => [document.name, document])
        );
        for (const document of uploadedDocuments) {
          byName.set(document.name, document);
        }
        replaceDocuments([...byName.values()]);
        setAvailability(true);
        setAvailabilityEvidence({
          threadId: targetThreadId,
          available: true,
        });
        setIsRefreshing(false);
      }
      if (!canRender) return;
    },
    [beginOperation, isCurrent, replaceDocuments]
  );

  const recordDeleteSuccess = useCallback(
    async (filename: string, activeThreadId?: string) => {
      const targetThreadId = activeThreadId ?? threadIdRef.current;
      if (!targetThreadId) {
        return { hasDocuments: null };
      }
      if (threadIdRef.current !== targetThreadId) {
        return { hasDocuments: null };
      }

      const epoch = beginOperation();
      const nextDocuments = documentsRef.current.filter(
        (document) => document.name !== filename
      );
      const hasDocuments = nextDocuments.length > 0;
      if (isCurrent(targetThreadId, epoch)) {
        replaceDocuments(nextDocuments);
        setAvailability(hasDocuments);
        setAvailabilityEvidence({
          threadId: targetThreadId,
          available: hasDocuments,
        });
        setIsRefreshing(false);
      }
      return { hasDocuments };
    },
    [beginOperation, isCurrent, replaceDocuments]
  );

  return {
    documents,
    availability,
    availabilityEvidence,
    isRefreshing,
    refresh,
    recordUploadSuccess,
    recordDeleteSuccess,
  };
}
