export const filterWith = <T, K>(sourceArray: T[], filterArray: K[], filterFn: (filterValue: K, sourceValue: T, index: number) => boolean): T[] => {
    return sourceArray.filter((value, index) => filterFn(filterArray[index], value, index))
}

// example:

// const paths = [
//     "some-dir",
//     "another-dir",
//     "some-file"
// ]

// const pathIsDir = [
//     true,
//     true,
//     false
// ]

// const dirs = filterWith(paths, pathIsDir, a => a)
