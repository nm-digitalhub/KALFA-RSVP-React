// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApprovePackageTermsForm } from './approve-package-terms-form';

// The package is approved by ticking two boxes — no signature pad, no phone code. The form also carries WHICH version
// of the terms the customer was shown, so the server can refuse an approval of terms that changed in the meantime.

afterEach(cleanup);

function form() {
  return render(<ApprovePackageTermsForm action={vi.fn()} termsVersion="2026-10-v6" />);
}

describe('ApprovePackageTermsForm', () => {
  it('has the two consent boxes, both unticked, and nothing about a signature or a code', () => {
    const { container } = form();
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes.map((b) => b.name)).toEqual(['terms_accepted', 'privacy_accepted']);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('[name="otp_code"]')).toBeNull();
    expect(container.querySelector('[name="signature"]')).toBeNull();
    expect(container.textContent).not.toMatch(/חתימה|קוד אימות|SMS/);
  });

  it('sends the version of the terms that was shown', () => {
    const { container } = form();
    expect((container.querySelector('[name="terms_version"]') as HTMLInputElement).value).toBe('2026-10-v6');
    expect((container.querySelector('[name="terms_version"]') as HTMLInputElement).type).toBe('hidden');
  });

  it('links the terms and the privacy policy so they can be opened from where the customer consents', () => {
    form();
    expect(screen.getByRole('link', { name: 'תנאי השירות' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: 'מדיניות הפרטיות' }).getAttribute('href')).toBe('/privacy');
  });

  it('the one button says what happens next: approve and continue to payment', () => {
    form();
    expect(screen.getByRole('button', { name: 'אישור והמשך לתשלום' })).toBeTruthy();
  });
});
