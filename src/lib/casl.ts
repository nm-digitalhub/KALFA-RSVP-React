// lib/casl.ts
import { createMongoAbility, MongoAbility, AbilityBuilder } from '@casl/ability';
import type { PlatformPermissionKey } from '@/lib/auth/platform-permission-keys.generated';

export type { PlatformPermissionKey };

export type CASLAction = PlatformPermissionKey | 'manage';

// מפת ה-Subjects מתוך ישויות המסד והטבלאות שברשותך (לפי הסכימה של Supabase ששלחת)
export type CASLSubject = 

  | 'campaigns' | 'events' | 'integrations' | 'rdp' | 'roles' | 'billing' 
  | 'settings' | 'staff' | 'voice' | 'activity_log' | 'customer_data' 
  | 'recordings' | 'webhooks' | 'packages' | 'all';

export type AppAbility = MongoAbility<[CASLAction, CASLSubject]>;

export interface CASLContextProfile {
  isStaff: boolean;
  isPlatformOwner: boolean;
  activeOrgId: string | null;
  activeRoleName: string | null;
  activePermissions: PlatformPermissionKey[]; // הרשאות שחזרו מהשרת אקטיבית
}

/**
 * מפעל ליצירת ה-Ability - מיישם Default Deny מוחלט
 */
export function createAppAbility(profile: CASLContextProfile | null): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // Default Deny: אין פרופיל או הרשאות - חסימה מלאה מיידית
  if (!profile) {
    return build();
  }

  // הגנת על לצוות הפלטפורמה הבכיר (Platform Owner / Super Admin)
  if (profile.isPlatformOwner) {
    can('manage', 'all');
    return build();
  }

  // החלת חוקים לצוות פלטפורמה רגיל (Staff) או למשתמשי ארגון
  if (profile.activePermissions && Array.isArray(profile.activePermissions)) {
    profile.activePermissions.forEach((perm) => {
      if (typeof perm !== 'string') return;

      if (perm.includes('.')) {
        // מבנה של resource.action (כמו campaigns.runstate או events.mark_test)
        const [resource] = perm.split('.');
        
        can(perm as CASLAction, resource as CASLSubject);
      } else {
        // מבנה של מפתח גלובלי שטוח (כמו manage_billing)
        let subject: CASLSubject = 'all';
        if (perm.includes('billing')) subject = 'billing';
        if (perm.includes('settings')) subject = 'settings';
        if (perm.includes('staff')) subject = 'staff';
        if (perm.includes('voice')) subject = 'voice';
        if (perm.includes('packages')) subject = 'packages';

        can(perm as CASLAction, subject);
      }
    });
  }

  return build();
}
