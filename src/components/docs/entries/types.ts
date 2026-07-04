import type { ComponentType } from "react";

export type DocExample = {
  title: string;
  /** Optional one-liner shown under the example title. */
  note?: string;
  /** The source shown (and copied) for this example — keep it in sync with Demo. */
  code: string;
  Demo: ComponentType;
};

export type DocEntry = {
  slug: string;
  name: string;
  group: string;
  intro: string;
  examples: DocExample[];
};
