import { migrate } from '../src/lib/migrate';
import { closePool } from '../src/lib/db';

migrate()
  .then((a) => console.log(a.length ? `migraciones aplicadas: ${a.join(', ')}` : 'base de datos al día'))
  .then(() => closePool())
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
