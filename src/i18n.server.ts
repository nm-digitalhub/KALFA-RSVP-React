import { createServerI18next } from 'next-i18next/server';

import i18nConfig from '@/i18n.config';

// Bound once here so no caller depends on an initialization order (next-i18next README, "Initialization without
// ordering assumptions").
export const { getT, getResources } = createServerI18next(i18nConfig);
