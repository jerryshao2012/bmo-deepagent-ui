export interface WikiTreeNode {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  children?: WikiTreeNode[];
}

export interface WikiTree {
  tree: WikiTreeNode;
  fileCount: number;
}

export interface WikiGraph {
  nodes: Array<{
    id: string;
    title: string;
    category: string;
    tags: string[];
    community_id: number | null;
  }>;
  edges: Array<{ source: string; target: string; weight: number }>;
  communities: Array<{ id: number; cohesion: number; size: number }>;
  total_pages: number;
  total_links: number;
}

export interface WikiGateway {
  getTree(threadId: string): Promise<WikiTree>;
  getFile(threadId: string, path: string): Promise<string>;
  getGraph(threadId: string): Promise<WikiGraph>;
}
