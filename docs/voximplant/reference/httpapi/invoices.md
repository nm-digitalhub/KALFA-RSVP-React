# Invoices  (ref_folder)


## DownloadInvoice  (api_method)

Downloads the specified invoice.

**Returns:** 

- `invoice_id` — Invoice ID


## GetAccountInvoices  (api_method)

Gets all invoices for the specified USD or EUR account.

**Returns:** 

- `count` — Number of invoices to show per page. Default value is 20

- `offset` — Number of invoices to skip (e.g. if you set count = 20 and offset = 0 the first time, the next time, offset has to be equal to 20 to skip the items shown earlier). Default value is 0
