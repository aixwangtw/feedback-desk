import { main } from './index';

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
        console.error(error);
        process.exit(1);
    },
);
