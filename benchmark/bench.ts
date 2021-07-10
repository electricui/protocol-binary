const { writeVersionInfo } = require('@electricui/build-rollup-config/benchmark')

async function main() {
  writeVersionInfo(__dirname)
  await require('./serialisation').serialisationBench
  await require('./deserialisation').deserialisationBench
}

main()
