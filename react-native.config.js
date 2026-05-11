module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.columnar.ColumnarPackage;',
        packageInstance: 'new ColumnarPackage()',
      },
    },
  },
};
