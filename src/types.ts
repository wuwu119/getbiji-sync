// INPUT: none
// OUTPUT: RawNote, BijiTag, BijiNote interfaces
// POS: Core data contracts for biji-sync note conversion

export interface RawNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  sourceUrl?: string;
  noteType?: string; // "link", "plain_text", "meeting", etc.
  entryType?: string; // "ai", "manual", "initial"
  origin?: string; // "app", "wechat", "web", etc.
  originalContent?: string; // For link-type notes
}

export interface BijiTag {
  id: string;
  name: string;
  type: string;
  count?: number;
}

export interface BijiNote {
  id: string;
  note_id: string;
  title: string;
  content: string;
  body_text: string;
  source: string; // maps to "origin" in RawNote
  note_type: string;
  entry_type: string;
  tags: BijiTag[];
  attachments: Array<{ type: string; url: string; title: string }>;
  created_at: string;
  updated_at: string;
  edit_time: string;
}
