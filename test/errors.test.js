const _ = require('../src/index.js')
const h = require('./helpers.js')
const { Readable, Writable } = require('stream')

test('error in source stream - exstream generator', () => {
  let i = 0
  _((write, next) => {
    i++
    if (i < 3) {
      write(i)
      next()
    } else if (i < 5) {
      write(Error(i))
      next()
    } else {
      write(_.nil)
    }
  })
    .errors((err, push) => {
      if (err.message === '3') push(null, 3)
    })
    .toArray(res => {
      expect(res).toEqual([1, 2, 3])
    })
})

test('fatal error in source stream - generator', () => {
  const errSkipped = []
  _(h.randomStringGenerator(5, 2))
    .errors((err, push) => {
      errSkipped.push(err)
    })
    .toArray(res => {
      expect(res.length).toBe(2)
      expect(res).toEqual(expect.not.arrayContaining(errSkipped))
    })
})

test('fatal error in source stream - async generator', async () => {
  const errSkipped = []
  const asyncGenerator = async function * () {
    for (let i = 0; i < 5; i++) {
      await h.sleep(10)
      if (i === 3) throw Error('can\t be 3!')
      else yield i
    }
  }

  const res = await _(asyncGenerator())
    .errors((err, push) => {
      errSkipped.push(err)
      push(null, 33)
    })
    .toPromise()

  expect(res.length).toBe(4)
  expect(res).toEqual(expect.not.arrayContaining(errSkipped))

  let errGenerated = null
  let errCatched = null
  await _(asyncGenerator())
    .errors((err, push) => {
      errGenerated = err
      push(err)
    })
    .toPromise()
    .catch(err => {
      errCatched = err
    })

  expect(errGenerated).not.toBe(null)
  expect(errCatched).toBe(errGenerated)
})

test('error in source stream - node stream', done => {
  const errs = []
  let i = 0
  _(new Readable({
    objectMode: true,
    read (size) {
      if (i === 4) {
        this.push(null)
      } else if (i > 2 && i < 4) {
        this.emit('error', Error('an error'))
      } else {
        this.push(i)
      }
      i++
    },
  }))
    .errors(e => (errs.push(e)))
    .toArray(res => {
      done()
      expect(res).toEqual([0, 1, 2])
      expect(errs.length).toBe(1)
      expect(errs[0].message).toBe('an error')
    })
})

test('error switching generator source', async () => {
  // this should be a stream, not a function
  const generatorFn = (write, next) => {
    write(1)
    next(generatorFn)
  }

  let ex
  await _(generatorFn)
    .toPromise()
    .catch(e => {
      ex = e
    })
  expect(ex).not.toBe(null)
  expect(ex.message).toBe('error in generator calling next(otherStream). ' +
  'otherStream must be an exstream instance, got function')
})

test('error in wrapped writable', async () => {
  const errs = []
  const res = await _([1, 2])
    .map(x => _([x]).through(new Writable({
      objectMode: true,
      write (chunk, enc, cb) {
        cb(Error('an error'))
      },
    }), { writable: true }))
    .merge()
    .errors(e => (errs.push(e)))
    .toPromise()
  expect(res).toEqual([])
  expect(errs.length).toBe(2)
  expect(errs[0].message).toBe('an error')
})

test('invalid source', () => {
  let ex
  try {
    _(1)
  } catch (e) {
    ex = e
  }
  expect(ex).not.toBe(null)
  expect(ex.message).toEqual('error creating exstream: invalid source. source can be one of: iterable, ' +
  'async iterable, exstream function, a promise, a node readable stream')
})

test('error in map', () => {
  _([1, 2, 3]).map(x => {
    if (x === 2) throw Error('can\'t be 2!!')
    else return x
  })
    .errors((err, push) => {
      if (err.exstreamInput === 2) push(null, 5)
    })
    .toArray(res => {
      expect(res).toEqual([1, 5, 3])
    })
})

test('error in resolve', async () => {
  let error
  const res = await _([1, 2, 3]).map(async x => {
    await h.sleep(10)
    if (x === 2) throw Error('can\'t be 2')
    return x
  }).resolve()
    .errors((err) => {
      error = err
    })
    .toPromise()

  expect(error).not.toBe(null)
  expect(res).toEqual([1, 3])
})

test('error in promise chain', async () => {
  let errorCatched = false
  const res = await _([1, 2, 3, 4, 5, 6])
    .map(async x => {
      await h.sleep(10)
      return x
    })
    .then(x => {
      if (x === 2) throw Error('err2')
      return x
    })
    .catch(e => {
      return 2
    })
    .then(x => {
      if (x === 5) throw Error('err5')
      return x
    })
    .resolve(3)
    .errors(() => {
      errorCatched = true
    })
    .map(x => {
      if (x === 6) throw Error('err6')
      return x
    })
    .map(x => x) // test error pass through
    .errors((err, push) => {
      if (err.message === 'err6') push(null, 6)
    })
    .toPromise()

  expect(errorCatched).toBe(true)
  expect(res).toEqual([1, 2, 3, 4, 6])
})

test('error in wrapped promise contains exstreamInput', async () => {
  const catched = jest.fn()

  const res = await _([1, 2, 3])
    .map(async x => {
      if (x === 2) throw Error('an error')
      else return x * 2
    }, { wrap: true })
    .resolve()
    .errors(e => {
      if (e.exstreamInput === 2) catched()
    })
    .pluck('output')
    .toPromise()

  expect(res).toEqual([2, 6])
  expect(catched).toHaveBeenCalledTimes(1)
})

test('synchronous tasks errors - chain is not synchronous', () => {
  let exception = false
  try {
    _([1, 2, 3, 4, 5, 6])
      .map(async x => x * 2)
      .resolve()
      .batch(3)
      .value() // Throw error because the chain is not synchronous
  } catch (e) {
    exception = true
  }
  expect(exception).toBe(true)
})

test('synchronous tasks errors - .value() with multiple values', () => {
  let exception = false
  try {
    _([1, 2, 3, 4, 5, 6])
      .value() // Throw error because the result has more than 1 value
  } catch (e) {
    exception = true
  }
  expect(exception).toBe(true)
})

test('synchronous tasks error - runtime error', () => {
  let exc = false
  try {
    _([1, 2, 3, 4, 5, 6])
      .map(x => {
        if (x === 3) throw Error('NOO')
        return x * 2
      })
      .values()
  } catch (e) {
    exc = e
  }
  expect(exc).not.toBe(null)
  expect(exc.message).toBe('NOO')
  expect(exc.exstreamInput).toBe(3)
})

test('piping an error', async () => {
  const res = []
  const errs = []
  return new Promise(resolve => {
    _([1, 2, 3])
      .map(x => { throw Error('NOO') })
      .on('error', e => errs.push(e))
      .pipe(h.getSlowWritable(res, 0, 10))
      .on('finish', () => {
        resolve()
        expect(res).toEqual([])
        expect(errs.length).toBe(3)
        expect(errs[2].message).toBe('NOO')
      })
  })
})

test('piping an error with pipeline', async () => {
  const res = []
  const errs = []

  const p = _.pipeline()
    .map(x => x)
    .map(x => { throw Error('NOO') })

  return new Promise(resolve => {
    _([1, 2, 3])
      .through(p.generateStream())
      .on('error', e => errs.push(e))
      .pipe(h.getSlowWritable(res, 0, 10))
      .on('finish', () => {
        resolve()
        expect(res).toEqual([])
        expect(errs.length).toBe(3)
        expect(errs[2].message).toBe('NOO')
      })
  })
})

test('error propagation', async () => {
  const errs = []
  const res = await _([1, 2, 3])
    .map(x => { throw Error('NOO') })
    .ratelimit(1, 10000)
    .batch(3)
    .flatten()
    .filter(x => x)
    .reject(x => x)
    .asyncFilter(async x => x)
    .uniq()
    .split()
    .splitBy('|')
    .uniqBy(x => x)
    .throttle(10)
    .csv()
    .csvStringify()
    .resolve()
    .slice(1, 3)
    .makeAsync(10)
    .errors(err => errs.push(err))
    .toPromise()

  expect(res).toEqual([])
  expect(errs.length).toBe(3)
  expect(errs[2].message).toBe('NOO')
})

test('resolve non promises', async () => {
  const errs = []
  _([1, 2, 3]).resolve().errors(e => errs.push(e)).resume()
  expect(errs.length).toBe(3)
  expect(errs[0].message).toBe('error in .resolve(). item must be a promise')
})

test('resolve promises errors', async () => {
  const errs = []
  await _([1, 2, 3])
    .map(async x => Promise.reject(Error('NOO')))
    .resolve(1, false)
    .errors(e => errs.push(e))
    .toPromise()
  expect(errs.length).toBe(3)
  expect(errs[0].message).toBe('NOO')
})

test('uniqBy errors', () => {
  const errs = []
  const res = _([1, 2, 3])
    .uniqBy(x => {
      if ('value' in x) return x.value
    })
    .errors(e => errs.push(e))
    .values()

  expect(res).toEqual([])
  expect(errs.length).toBe(3)
})

test('each errors', () => {
  let i = 1
  const res = []
  let exc = false
  _([1, 2, 3, 'NOO', 'NOO', 4])
    .map(x => { if (_.isString(x)) throw Error(x); else return x })
    .on('error', e => {
      exc = true
      expect(e.message).toBe('NOO')
    }).each(x => {
      res.push(x)
      expect(x).toBe(i++)
    })
  expect(exc).toBe(true)
  expect(res).toEqual([1, 2, 3, 4])
})

test('filter errors', () => {
  let ex
  const res = _([1, 2, 3])
    .filter(x => {
      if (x === 3) throw Error('NOO')
      return true
    })
    .errors(e => (ex = e))
    .values()
  expect(res).toEqual([1, 2])
  expect(ex).not.toBe(null)
  expect(ex.exstreamInput).toBe(3)
})

test('reject errors', () => {
  let ex
  const res = _([1, 2, 3])
    .reject(x => {
      if (x === 3) throw Error('NOO')
      return true
    })
    .errors(e => (ex = e))
    .values()
  expect(res).toEqual([])
  expect(ex).not.toBe(null)
  expect(ex.exstreamInput).toBe(3)
})

test('async filter errors', async () => {
  let e
  const res = await _([1, 2, 3])
    .asyncFilter(async x => {
      await h.sleep(100)
      if (x === 3) throw Error('NOO')
      return true
    })
    .errors(ex => (e = ex))
    .toPromise()

  expect(res).toEqual([1, 2])
  expect(e).not.toBe(null)
  expect(e.message).toBe('NOO')
})

test('stream in error without consumers emits an error event', done => {
  _([1]).map(x => { throw Error('an error') }).on('error', e => {
    done()
    expect(e).not.toBe(null)
    expect(e.message).toBe('an error')
  }).resume()
})
