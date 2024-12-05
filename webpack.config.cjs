const path = require("path");

module.exports = {
  // Entry point of your application
  entry: "./src/index.js",

  // Output configuration
  output: {
    filename: "bundle.js",
    path: path.resolve(__dirname, "dist"),
  },

  // Module rules for loaders
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
        },
      },
    ],
  },
};
