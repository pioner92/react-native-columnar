cmake_minimum_required(VERSION 3.4.1)
project(react-native-columnar)

add_library(react-native-columnar INTERFACE)

target_include_directories(react-native-columnar INTERFACE
  ${CMAKE_CURRENT_SOURCE_DIR}/../cpp
)
