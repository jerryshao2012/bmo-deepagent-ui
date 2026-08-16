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
  updateThreadState: (
    threadId: string,
    values: Record<string, unknown>
  ) => Promise<void>;
}

interface UploadSuccess {
  activeThreadId?: string;
  documents: ThreadDocument[];
  docFolder: string;
}

const unavailableState = {
  has_documents: false,
  doc_folder: null,
};

export function useThreadDocumentAvailability({
  threadId,
  listDocuments,
  updateThreadState,
}: UseThreadDocumentAvailabilityOptions) {
  const [documents, setDocuments] = useState<ThreadDocument[]>([]);
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const documentsRef = useRef<ThreadDocument[]>([]);
  const threadIdRef = useRef(threadId);
  const listDocumentsRef = useRef(listDocuments);
  const updateThreadStateRef = useRef(updateThreadState);
  const renderedThreadIdRef = useRef(threadId);
  const operationEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const persistenceTailsRef = useRef(new Map<string, Promise<void>>());

  threadIdRef.current = threadId;
  listDocumentsRef.current = listDocuments;
  updateThreadStateRef.current = updateThreadState;
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

  const enqueuePersistence = useCallback(
    (
      targetThreadId: string,
      values: Record<string, unknown>,
      epoch: number,
      allowUnrendered = false
    ): Promise<boolean> => {
      const persist = async () => {
        if (!isCurrent(targetThreadId, epoch, allowUnrendered)) return false;

        try {
          await updateThreadStateRef.current(targetThreadId, values);
          return true;
        } catch (error) {
          console.error("Failed to persist document availability:", error);
          return false;
        }
      };

      const previous =
        persistenceTailsRef.current.get(targetThreadId) ?? Promise.resolve();
      const persistence = previous.then(persist, persist);
      const tail = persistence.then(
        () => undefined,
        () => undefined
      );
      persistenceTailsRef.current.set(targetThreadId, tail);
      void tail.then(() => {
        if (persistenceTailsRef.current.get(targetThreadId) === tail) {
          persistenceTailsRef.current.delete(targetThreadId);
        }
      });
      return persistence;
    },
    [isCurrent]
  );

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

        await enqueuePersistence(
          targetThreadId,
          hasDocuments
            ? {
                has_documents: true,
                doc_folder: `docs/threads/${targetThreadId}`,
              }
            : unavailableState,
          epoch,
          allowUnrendered
        );
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
    [enqueuePersistence, isCurrent, replaceDocuments]
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
    async ({
      activeThreadId,
      documents: uploadedDocuments,
      docFolder,
    }: UploadSuccess) => {
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
        setIsRefreshing(false);
      }

      return enqueuePersistence(
        targetThreadId,
        {
          has_documents: true,
          doc_folder: docFolder,
        },
        epoch,
        allowUnrendered
      );
    },
    [beginOperation, enqueuePersistence, isCurrent, replaceDocuments]
  );

  const recordDeleteSuccess = useCallback(
    async (filename: string, activeThreadId?: string) => {
      const targetThreadId = activeThreadId ?? threadIdRef.current;
      if (!targetThreadId) {
        return { persisted: false, hasDocuments: null };
      }
      if (threadIdRef.current !== targetThreadId) {
        return { persisted: false, hasDocuments: null };
      }

      const epoch = beginOperation();
      const nextDocuments = documentsRef.current.filter(
        (document) => document.name !== filename
      );
      const hasDocuments = nextDocuments.length > 0;
      if (isCurrent(targetThreadId, epoch)) {
        replaceDocuments(nextDocuments);
        setAvailability(hasDocuments);
        setIsRefreshing(false);
      }

      const persisted = await enqueuePersistence(
        targetThreadId,
        hasDocuments ? { has_documents: true } : unavailableState,
        epoch
      );
      return { persisted, hasDocuments };
    },
    [beginOperation, enqueuePersistence, isCurrent, replaceDocuments]
  );

  return {
    documents,
    availability,
    isRefreshing,
    refresh,
    recordUploadSuccess,
    recordDeleteSuccess,
  };
}
