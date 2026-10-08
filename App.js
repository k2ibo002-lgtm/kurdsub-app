import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import HomeScreen from "./src/screens/HomeScreen";
import PlayerScreen from "./src/screens/PlayerScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: "#0b0e14" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "bold" },
          contentStyle: { backgroundColor: "#0b0e14" },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "کوردسەب" }} />
        <Stack.Screen name="Player" component={PlayerScreen} options={{ title: "سەیرکردن" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
