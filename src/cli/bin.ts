import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { main } from './index';

// Node tries each address of a host for only 250 ms before moving to the next (alternating IPv4 and IPv6).
// On slower links, or where IPv6 is not routed (WSL is a common case), every attempt times out and
// fetch fails with "fetch failed" although the site is reachable. Give each attempt longer.
setDefaultAutoSelectFamilyAttemptTimeout(2500);

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
        console.error(error);
        process.exit(1);
    },
);
