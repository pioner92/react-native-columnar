require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-columnar"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/pioner92/react-native-columnar.git", :tag => "#{s.version}" }

  s.source_files       = "cpp/**/*.{hpp,cpp,c,h}"
  s.header_mappings_dir = "cpp"

  s.dependency "React-jsi"
end
