cmake_minimum_required(VERSION 3.4.1)
project(Columnar)

set (CMAKE_VERBOSE_MAKEFILE ON)

add_library(
    react-native-columnar    STATIC
    ../cpp/ColumnarImpl.cpp
)

set_target_properties(
    react-native-columnar PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)

target_include_directories(
    react-native-columnar    PUBLIC
    ../cpp
)

target_link_libraries(
    react-native-columnar    jsi
    reactnative
    react_codegen_ColumnarSpec
)
