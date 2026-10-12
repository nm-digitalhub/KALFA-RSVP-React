# 8.1 — the D8 equality query, run on live

Run 13.10.2026 00:37 IDT, linked project (read-only), after the full benefit call
(conv_3901m4rycw…) and today's package-change/benefit traffic.

```sql
select c.id as campaign_id, c.package_price as old_column, p.package_price as round_price, c.status
from campaigns c
left join campaign_pricing p on p.campaign_id = c.id and p.superseded_at is null
where c.package_price is distinct from p.package_price;
```

Result: **0 rows** — on every one of the 8 campaigns the legacy `campaigns.package_price`
equals its current round's `campaign_pricing.package_price` (5 campaigns carry a price;
the 3 old-model campaigns are NULL on both sides, which `is distinct from` treats as equal).

The mirror held through every live mutation of 12.10 (package changes, benefit binds, the
agent-granted assignment). 8.3 (dropping the mirror trigger and the column) may proceed
once the deployed code no longer reads the column.
