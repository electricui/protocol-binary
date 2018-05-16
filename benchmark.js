import BinaryProtocolEncoder from './src/encoder'
import BinaryProtocolDecoder from './src/decoder'
import Benchmark from 'benchmark'

const suite = new Benchmark.Suite()
const parser = new BinaryProtocolEncoder()

// add tests
suite
  .add('Binary Protocol Write (small packet)', function() {
    parser.write({
      messageID: 'f',
      type: 0,
      payload: 'fff'
    })
  })
  .add('Binary Protocol Write (longest payload possible)', function() {
    parser.write({
      messageID: 'fff',
      type: 15,
      payload:
        'abcdefghtyabcdefghtyabcdefghtyabcdefghthtybcdefghtyabcdefghtyabcdebcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghtyabcdefghty'
    })
  })
  // add listeners
  .on('cycle', function(event) {
    console.log(String(event.target))
  })
  // run async
  .run()
