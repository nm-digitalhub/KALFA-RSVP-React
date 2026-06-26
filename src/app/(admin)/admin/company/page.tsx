import { getCompanySettings } from '@/lib/data/admin/settings';
import { PageHeading } from '../_components';
import { CompanyForm } from './company-form';

const sectionClass = 'space-y-4 rounded-lg border border-border bg-card p-5';

// Admin: company / legal details embedded in the signed agreement (§14ג
// mandatory disclosures + privacy + warranty). requireAdmin() is enforced in the
// data layer. The agreement reads these values live.
export default async function AdminCompanyPage() {
  const settings = await getCompanySettings();

  return (
    <div className="space-y-6">
      <PageHeading>פרטי חברה והסכם</PageHeading>

      <section className={sectionClass}>
        <div>
          <h2 className="text-lg font-semibold">זהות החברה ומסמכים משפטיים</h2>
          <p className="text-sm text-muted-foreground">
            פרטים אלה מופיעים בהסכם שהלקוח חותם עליו (גילוי חובה לפי חוק הגנת
            הצרכן §14ג). כל עדכון משתקף בהסכם באופן מיידי. מומלץ שעו״ד יאשר את
            הנוסח הסופי לפני הפעלה מסחרית.
          </p>
        </div>
        <CompanyForm settings={settings} />
      </section>
    </div>
  );
}
