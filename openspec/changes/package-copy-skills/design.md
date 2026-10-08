# Design

Install skills CLI 1.7.1 as a production dependency. The server maps description and includes to Hebrew writer 1.3.0, invokes npx --no-install skills use without --agent, extracts the embedded main SKILL.md, and caches the in-flight promise. Failed loads are evicted so staff can retry. Fixed output and factual constraints override general skill guidance. The main skill file is supplied directly; supporting references and tools are not loaded. A process restart clears the cache. The first request needs outbound GitHub access.
