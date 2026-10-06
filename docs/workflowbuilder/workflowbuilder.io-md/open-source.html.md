# Workflow Builder Open Source - Apache 2.0 on GitHub

Open Source

## Open Source Workflow Builder – Apache 2.0 React SDK + Reference Backend

Open source Workflow Builder under Apache 2.0. React SDK + reference back-end + Temporal adapter, free on GitHub. Commercial use OK, no copyleft, no relicensing.

![license](https://img.shields.io/github/license/synergycodes/workflowbuilder?style=flat-square) ![GitHub Stars](https://img.shields.io/github/stars/synergycodes/workflowbuilder?style=flat-square&logo=github&logoColor=white&color=5360f9)

What is open source vs what is Enterprise

## The full three-block stack is in Community Edition

Apache 2.0 covers the visual workflow editor, the reference back-end, and the Temporal adapter. You can ship a complete workflow product on Community alone. Enterprise adds premium components on top.

Component

Community (Apache 2.0)

Enterprise (EUR 6,990)

Visual workflow editor (React SDK on NPM)

Yes

Yes

Reference back-end (HTTP API + graph runner)

Yes

Yes

Temporal integration adapter

Yes

Yes

Three port interfaces (engine-agnostic)

Yes

Yes

Full source code on public GitHub

Yes

Yes

Community support (GitHub issues)

Yes

Yes

Commercial use, no royalty

Yes

Yes

Figma Kit

No

Yes

Advanced canvas plugins (ELK auto-layout, smart edge routing, edge reshaping)

No

Yes

Priority GitHub issues

No

Yes

Enterprise SLA (on-demand, terms negotiated individually)

No

Yes

License comparison vs alternatives

## Workflow tools and their license footprint

Open source means different things to different vendors. Workflow Builder Community is Apache 2.0 on public GitHub with no copyleft. Here is how that compares.

Vendor

License

Commercial use

Notes

Workflow Builder Community

Apache 2.0

Yes, no royalty

Public GitHub, no copyleft, perpetual

n8n

Sustainable Use License

Restricted

Formally NOT open source; embed/enterprise tier est. ~$50,000/yr ([community estimate](#))

Camunda Community

Limited OSS

Restricted

Camunda 8 Self-Managed requires commercial license

GoJS

Commercial

License purchase

$3,995-$11,950 per developer ([source](#))

JointJS Plus

Commercial

License purchase

from $3,490 per developer, perpetual ([source](#))

React Flow

MIT

Yes

Comparable liberal license - WB is built on it

Temporal

MIT

Yes

Comparable liberal license for self-hosting

Inngest

Dual

Mixed

Apache 2.0 client SDK + commercial cloud platform

Conductor OSS

Apache 2.0

Yes

Comparable liberal license

Flowable

Apache 2.0

Yes

Comparable liberal license

License footprint as of 2026-05. Each vendor's license terms are subject to change - we link to canonical pages above for verification.

Why Apache 2.0 matters

## Three reasons the license you pick is a load-bearing decision

Commercial use, no royalty

You can take Workflow Builder Community, build a SaaS product on top, and sell it to customers. No revenue share. No commercial license required. The reference back-end, Visual workflow editor, and Temporal adapter are all yours to ship commercially.

No copyleft, protect your IP

Apache 2.0 is permissive. Modify Workflow Builder, ship the modified version in your closed-source product, and you do not have to publish your changes. No GPL-style derivative work clause. Your code stays your code.

Vendor lock-in protection

Even if Synergy Codes disappears tomorrow (unlikely after 15 years in the industry, but humor us), you have the full source under Apache 2.0, perpetually. You can fork, run, modify, and ship without depending on any vendor service. The engine adapters are swappable - no lock-in to Temporal either.

Live data from GitHub. Refreshes every few minutes.

Built on

## Built on shoulders of giants - every dependency is OSS-permissive

Every dependency in our stack is permissively licensed and battle-tested. No SaaS-only black boxes in the critical path - if any library disappears tomorrow, you can fork it.

![React Flow (xyflow) logo](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3a59a523d1dc18edb2da23_a25a010576b6df15c13e17f86afb0d61_builton-reactflow.jpg)

Canvas foundation.  
We contribute upstream.

![Temporal logo](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3a59a812c6d02c8e500cf0_builton-temporal.png)

Reference durable execution engine.

![ELK logo](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3a5bb17d6555cb96437f1b_builton-elk-png.png)

![libavoid icon](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3a5bb346fee27b5d89d5a5_builton-libavoid-png.png)

Edge routing without overlaps.

![Hono logo](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3a59ac06c37269a56103ec_builton-hono.png)

![React logo](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3a59aeaa0675392b6fb322_builton-react.png)

![TypeScript logo](https://cdn.prod.website-files.com/67121c7b454e7d1dfb641e68/6a3a59b00f8f1f6bbca20177_builton-typescript.png)

CASE STUDIES

Open source FAQ

## Questions developers ask before they clone

-   Is the reference back-end also open source?
    
    Yes. The reference back-end is part of Community Edition under Apache 2.0. Full source code on github.com/synergycodes/workflowbuilder, including the Temporal integration adapter, the three port interfaces, and the docker compose dev environment. [See what is in the reference stack →](https://www.workflowbuilder.io/reference-stack)
    
-   Can I sell a product built on Workflow Builder Community Edition?
    
    Yes. Apache 2.0 allows commercial use. You can build and sell a SaaS product on top of Workflow Builder Community Edition with no royalty, no revenue share, no commercial license needed. Many enterprise customers run Community Edition and never upgrade to Enterprise.
    
-   Do I need a commercial license to use Workflow Builder in a commercial product?
    
    No. Apache 2.0 covers commercial use. The Enterprise license is optional and adds Enterprise-only components (Flow Runner plugin, Figma Kit, advanced canvas plugins) - it is not a requirement for commercial use of Community Edition. [See pricing for comparison →](https://www.workflowbuilder.io/pricing)
    
-   What is the difference between Community Edition and Enterprise Edition?
    
    Community Edition (Apache 2.0, free) includes the visual workflow editor, reference back-end, Temporal adapter, three port interfaces, and full source on GitHub. Enterprise Edition (EUR 6,990 one-time) adds source code access to Enterprise-only components, Flow Runner plugin, Figma Kit, advanced canvas plugins (ELK auto-layout, smart edge routing, edge reshaping), and priority GitHub issues.
    
-   Will Apache 2.0 ever change to BSL or SSPL?
    
    **No.** Apache 2.0 is our hard commit. We watched the MongoDB SSPL, Elastic SSPL, HashiCorp BSL, and Redis SAL relicensing events. Workflow Builder Community Edition stays Apache 2.0. The source code in the GitHub repo is yours under that license, perpetually. If you have already cloned a Community release, no future change affects that copy.
    
-   Apache 2.0 is a permissive license. You can modify Workflow Builder and ship the modified version in your closed-source product without publishing your changes. No GPL-style requirement to release your derivative work. Your IP stays your IP.