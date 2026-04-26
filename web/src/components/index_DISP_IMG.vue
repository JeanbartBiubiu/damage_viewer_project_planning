<template>
  <el-image
    :src="src"
    :preview-src-list="src ? [src] : []"
    fit="cover"
    style="width: 50px; height: 50px; border-radius: 4px"
  >
    <!-- 空图占位 -->
    <template #error>
      <el-icon :size="24" color="#c0c4cc">
        <Picture />
      </el-icon>
    </template>
  </el-image>
</template>

<script lang="ts" setup>
import { ref, onMounted, watch } from "vue"
import { Picture } from "@element-plus/icons-vue"
import { imageManager } from "@/utils/image/image_manager"

interface Props {
  game: string
  type: string
  id: number | undefined
}

const props = defineProps<Props>()
const src = ref<string>("")

const loadImage = async () => {
  if (props.id === undefined) {
    src.value = ""
    return
  }
  try {
    const uri = `${props.game}_${props.type}_${props.id}`
    const data = await imageManager.getImageByUri(uri)
    src.value = data || ""
  } catch {
    src.value = ""
  }
}

onMounted(loadImage)
watch(() => [props.game, props.type, props.id], loadImage, { immediate: true })
</script>
