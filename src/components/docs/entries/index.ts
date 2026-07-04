import { GUIDES } from "./guides";
import { SURFACES } from "./surfaces";
import { INPUTS } from "./inputs";
import { SELECTION } from "./selection";
import { NAVIGATION } from "./navigation";
import { OVERLAYS } from "./overlays";
import { DATA } from "./data";
import { FEEDBACK } from "./feedback";

export type { DocEntry, DocExample } from "./types";

export const ENTRIES = [...GUIDES, ...SURFACES, ...INPUTS, ...SELECTION, ...NAVIGATION, ...OVERLAYS, ...DATA, ...FEEDBACK];
