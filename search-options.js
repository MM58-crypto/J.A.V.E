const COUNTRIES = [
  { code: 'MY', name: 'Malaysia' },
  { code: 'OM', name: 'Oman' },
  { code: 'SG', name: 'Singapore' },
  { code: 'SA', name: 'Saudi Arabia' },
];
const DEFAULT_COUNTRIES = ['MY', 'OM'];
const MAX_AGE_HOURS = 24;

function resolveCountries(codes = DEFAULT_COUNTRIES) {
  if (!Array.isArray(codes) || codes.length === 0) {
    throw new Error('Select at least one country: MY, OM, SG, or SA.');
  }
  const selected = new Set(codes.map(value => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    const country = COUNTRIES.find(candidate =>
      candidate.code.toLowerCase() === normalized || candidate.name.toLowerCase() === normalized);
    if (!country) {
      throw new Error(`Unknown country "${value}". Choose MY (Malaysia), OM (Oman), SG (Singapore), or SA (Saudi Arabia).`);
    }
    return country.code;
  }));
  return COUNTRIES.filter(country => selected.has(country.code));
}

function parseCliOptions(argv, { allowDemo = false, allowKeyword = false } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const options = { help: false, demo: false, countries: undefined, keyword: undefined };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--countries' || arg.startsWith('--countries=')) {
      const value = arg === '--countries' ? argv[++index] : arg.slice('--countries='.length);
      if (!value || value.startsWith('-')) {
        throw new Error('--countries requires a comma-separated selection, for example --countries MY,OM.');
      }
      options.countries = resolveCountries(value.split(',')).map(country => country.code);
    } else if (arg === '--demo' && allowDemo) {
      options.demo = true;
    } else if (!arg.startsWith('-') && allowKeyword && options.keyword === undefined) {
      options.keyword = arg.trim();
      if (!options.keyword) throw new Error('Please enter a nonempty job keyword.');
    } else {
      throw new Error(`Unexpected argument "${arg}". Use --help for usage.`);
    }
  }
  return options;
}

function readCliOptions(command, argv = process.argv.slice(2)) {
  try {
    const options = parseCliOptions(argv, {
      allowDemo: command === 'scout',
      allowKeyword: command === 'apply',
    });
    if (options.help) {
      console.log(cliHelp(command));
      process.exit(0);
    }
    return options;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

async function promptCountries(defaults = DEFAULT_COUNTRIES) {
  const inquirer = require('inquirer');
  const selected = resolveCountries(defaults).map(country => country.code);
  const { countries } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'countries',
    message: 'Search countries (Space to select; choose at least one):',
    choices: COUNTRIES.map(country => ({ name: `${country.name} (${country.code})`, value: country.code })),
    default: selected,
    validate: values => values.length > 0 || 'Select at least one country.',
  }]);
  return resolveCountries(countries).map(country => country.code);
}

function searchScope(countries) {
  const names = resolveCountries(countries).map(country => country.name).join(', ');
  return `Countries: ${names} | Last ${MAX_AGE_HOURS} hours only (verified age < ${MAX_AGE_HOURS}h) | Local career-profile match required`;
}

function cliHelp(command) {
  const scout = command === 'scout';
  return [
    `Usage: node ${command}.js${scout ? '' : ' "Software Engineer"'} [--countries MY,OM]${scout ? ' [--demo]' : ''}`,
    '',
    '  --countries CODES  Comma-separated codes or full names (also --countries=MY,OM).',
    '                     MY Malaysia, OM Oman, SG Singapore, SA Saudi Arabia.',
    '                     Default priority: Malaysia, then Oman; checkbox selection if omitted.',
    ...(scout ? ['  --demo             Use clearly synthetic country-specific jobs; no API keys required.'] : []),
    '  --help, -h         Show help without loading profiles/resumes or accessing the network.',
    '',
    `Only verified postings younger than ${MAX_AGE_HOURS} hours with a local career-profile match are displayed.`,
    'Source failures are reported separately; displayed source counts include only matching jobs.',
  ].join('\n');
}

module.exports = {
  COUNTRIES,
  DEFAULT_COUNTRIES,
  MAX_AGE_HOURS,
  resolveCountries,
  parseCliOptions,
  readCliOptions,
  promptCountries,
  searchScope,
  cliHelp,
};
