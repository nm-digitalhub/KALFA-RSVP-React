interface CustomerNumberFieldProps {
  // The number SUMIT gave this account at its first payment; null until then.
  customerNumber: number | null;
  // The settings page's own input styling, so the field looks like its neighbours.
  inputClassName: string;
}

// A read-only display of the account's SUMIT customer number. Two things are deliberate:
//   - it has NO `name`, so it is never submitted with the profile form: the number comes from SUMIT's answer to a
//     payment and is not something a user types (see readSumitCustomerNumber for why it is not a profile column);
//   - it is written left-to-right, so the digits keep their order inside the right-to-left page.
export function CustomerNumberField({ customerNumber, inputClassName }: CustomerNumberFieldProps) {
  return (
    <div>
      <label htmlFor="customer_number" className="mb-1 block text-sm font-medium">
        מספר לקוח
      </label>
      <input
        id="customer_number"
        type="text"
        dir="ltr"
        readOnly
        value={customerNumber === null ? '' : String(customerNumber)}
        placeholder="יופיע לאחר התשלום הראשון"
        aria-describedby="customer_number_hint"
        className={`${inputClassName} bg-muted/40 text-start`}
      />
      <p id="customer_number_hint" className="mt-1 text-xs text-muted-foreground">
        מספר הלקוח שלכם. הוא נוצר בתשלום הראשון ואינו ניתן לעריכה.
      </p>
    </div>
  );
}
