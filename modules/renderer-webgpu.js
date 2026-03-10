const state = require('./state');
const utils = require('./utils');
const shapesModule = require('./shapes');
const { getStroke } = require('perfect-freehand');

let device = null;
let context = null;
let canvasFormat = null;
let pipeline = null;
let strokePipeline = null;
let uniformBuffer = null;
let uniformBindGroup = null;
let depthTexture = null;

// 批处理和缓存
let batchBufferSize = 10000; // 预分配的顶点数量
let positionBuffer = null;
let colorBuffer = null;
let bufferCapacity = 0;

// 缓冲区缓存
const bufferCache = new Map();

// 性能监控
const performanceStats = {
    frameCount: 0,
    lastFpsTime: 0,
    currentFps: 60,
    renderTime: 0,
    drawCalls: 0,
    verticesDrawn: 0
};

let isInitialized = false;
let initPromise = null;

const shaderCode = `
struct Uniforms {
    resolution: vec2<f32>,
    cameraPos: vec2<f32>,
    cameraZoom: f32,
    padding: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

@vertex
fn vs_main(
    @location(0) position: vec2<f32>,
    @location(1) color: vec4<f32>
) -> VertexOutput {
    var output: VertexOutput;
    
    let worldPos = (position - uniforms.cameraPos) * uniforms.cameraZoom;
    let clipPos = vec2<f32>(
        worldPos.x / uniforms.resolution.x * 2.0 - 1.0,
        1.0 - worldPos.y / uniforms.resolution.y * 2.0
    );
    
    output.position = vec4<f32>(clipPos, 0.0, 1.0);
    output.color = color;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}
`;

async function initWebGPU(canvas) {
    if (isInitialized) return true;
    if (initPromise) return initPromise;
    
    initPromise = (async () => {
        try {
            if (!navigator.gpu) {
                console.warn('[WebGPU] WebGPU not supported, falling back to Canvas2D');
                return false;
            }
            
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.warn('[WebGPU] No GPU adapter found');
                return false;
            }
            
            device = await adapter.requestDevice();
            context = canvas.getContext('webgpu');
            
            if (!context) {
                console.warn('[WebGPU] Could not get WebGPU context');
                return false;
            }
            
            const dpr = window.devicePixelRatio || 1;
            canvasFormat = navigator.gpu.getPreferredCanvasFormat();
            context.configure({
                device: device,
                format: canvasFormat,
                alphaMode: 'premultiplied',
                size: {
                    width: Math.floor(canvas.clientWidth * dpr),
                    height: Math.floor(canvas.clientHeight * dpr)
                }
            });
            
            const shaderModule = device.createShaderModule({
                code: shaderCode
            });
            
            pipeline = device.createRenderPipeline({
                layout: 'auto',
                vertex: {
                    module: shaderModule,
                    entryPoint: 'vs_main',
                    buffers: [{
                        arrayStride: 8,
                        attributes: [{
                            shaderLocation: 0,
                            offset: 0,
                            format: 'float32x2'
                        }]
                    }, {
                        arrayStride: 16,
                        attributes: [{
                            shaderLocation: 1,
                            offset: 0,
                            format: 'float32x4'
                        }]
                    }]
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fs_main',
                    targets: [{
                        format: canvasFormat,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add'
                            }
                        }
                    }]
                },
                primitive: {
                    topology: 'triangle-list',
                }
            });
            
            uniformBuffer = device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            
            uniformBindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [{
                    binding: 0,
                    resource: { buffer: uniformBuffer }
                }]
            });
            
            // 创建批处理缓冲区
            createBatchBuffers();
            
            isInitialized = true;
            console.log('[WebGPU] Initialized successfully');
            return true;
        } catch (e) {
            console.error('[WebGPU] Initialization failed:', e);
            return false;
        }
    })();
    
    return initPromise;
}

function createBatchBuffers() {
    // 为批处理创建大型缓冲区
    const positionSize = batchBufferSize * 2 * 4; // 每个顶点2个float，每个float4字节
    const colorSize = batchBufferSize * 4 * 4; // 每个顶点4个float，每个float4字节
    
    positionBuffer = device.createBuffer({
        size: positionSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    
    colorBuffer = device.createBuffer({
        size: colorSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    
    bufferCapacity = batchBufferSize;
}

function getCachedBuffer(key, size, usage) {
    const cacheKey = `${key}_${size}`;
    if (bufferCache.has(cacheKey)) {
        return bufferCache.get(cacheKey);
    }
    
    const buffer = device.createBuffer({
        size: size,
        usage: usage,
    });
    
    bufferCache.set(cacheKey, buffer);
    return buffer;
}

function createVertexBuffer(points, color) {
    const vertexCount = points.length;
    const positionData = new Float32Array(vertexCount * 2);
    const colorData = new Float32Array(vertexCount * 4);
    
    for (let i = 0; i < vertexCount; i++) {
        positionData[i * 2] = points[i][0];
        positionData[i * 2 + 1] = points[i][1];
        
        const r = parseInt(color.slice(1, 3), 16) / 255;
        const g = parseInt(color.slice(3, 5), 16) / 255;
        const b = parseInt(color.slice(5, 7), 16) / 255;
        const a = 1.0;
        
        colorData[i * 4] = r;
        colorData[i * 4 + 1] = g;
        colorData[i * 4 + 2] = b;
        colorData[i * 4 + 3] = a;
    }
    
    const positionBuffer = getCachedBuffer('position', positionData.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(positionBuffer, 0, positionData);
    
    const colorBuffer = getCachedBuffer('color', colorData.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(colorBuffer, 0, colorData);
    
    return { positionBuffer, colorBuffer, vertexCount };
}

function triangulateStroke(outlinePoints) {
    const triangles = [];
    const n = outlinePoints.length;
    
    if (n < 3) return triangles;
    
    // 优化三角剖分：使用扇面三角剖分，但跳过重复点
    const firstPoint = outlinePoints[0];
    let lastPoint = firstPoint;
    
    for (let i = 1; i < n - 1; i++) {
        const currentPoint = outlinePoints[i];
        const nextPoint = outlinePoints[i + 1];
        
        // 跳过重复点，减少顶点数量
        if (
            (currentPoint[0] === lastPoint[0] && currentPoint[1] === lastPoint[1]) ||
            (nextPoint[0] === currentPoint[0] && nextPoint[1] === currentPoint[1])
        ) {
            continue;
        }
        
        triangles.push(
            firstPoint[0], firstPoint[1],
            currentPoint[0], currentPoint[1],
            nextPoint[0], nextPoint[1]
        );
        
        lastPoint = currentPoint;
    }
    
    return triangles;
}

function renderStrokeWebGPU(stroke, camera) {
    if (!device || !stroke.points || stroke.points.length < 2) return null;
    
    const { points, color, size, taper } = stroke;
    
    // 计算缓存键
    const cacheKey = `stroke_${points.length}_${color}_${size}_${taper ? 1 : 0}`;
    
    // 检查缓存
    if (bufferCache.has(cacheKey)) {
        return bufferCache.get(cacheKey);
    }
    
    const outlinePoints = getStroke(points, {
        size: taper ? size : Math.max(1, size - 1),
        thinning: taper ? 0.7 : 0,
        smoothing: stroke.smoothing !== undefined ? stroke.smoothing : 0.5,
        streamline: stroke.streamline !== undefined ? stroke.streamline : 0.5,
        start: { taper: taper ? size : 0, easing: (t) => t },
        end: { taper: taper ? size : 0, easing: (t) => t }
    });
    
    if (outlinePoints.length < 3) return null;
    
    const triangles = triangulateStroke(outlinePoints);
    if (triangles.length === 0) return null;
    
    const vertexCount = triangles.length / 2;
    const positionData = new Float32Array(triangles);
    const colorData = new Float32Array(vertexCount * 4);
    
    let r = 1, g = 1, b = 1, a = 1;
    if (color && color.startsWith('#')) {
        r = parseInt(color.slice(1, 3), 16) / 255;
        g = parseInt(color.slice(3, 5), 16) / 255;
        b = parseInt(color.slice(5, 7), 16) / 255;
    }
    
    if (stroke.type === 'eraser') {
        a = 0;
    }
    
    // 批量填充颜色数据
    for (let i = 0; i < vertexCount; i++) {
        colorData[i * 4] = r;
        colorData[i * 4 + 1] = g;
        colorData[i * 4 + 2] = b;
        colorData[i * 4 + 3] = a;
    }
    
    // 使用缓存的缓冲区
    const positionBuffer = getCachedBuffer('stroke_position', positionData.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(positionBuffer, 0, positionData);
    
    const colorBuffer = getCachedBuffer('stroke_color', colorData.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(colorBuffer, 0, colorData);
    
    const result = { positionBuffer, colorBuffer, vertexCount };
    
    // 缓存结果
    bufferCache.set(cacheKey, result);
    
    return result;
}

function renderShapeWebGPU(stroke, camera) {
    if (!device) return null;
    
    const color = stroke.color || '#ffffff';
    const shapeType = stroke.shapeType;
    const start = stroke.start;
    const end = stroke.end;
    const size = stroke.size || 2;
    
    if (!start || !end) return null;
    
    // 计算缓存键
    const cacheKey = `shape_${shapeType}_${start.x}_${start.y}_${end.x}_${end.y}_${size}_${color}`;
    
    // 检查缓存
    if (bufferCache.has(cacheKey)) {
        return bufferCache.get(cacheKey);
    }
    
    const triangles = [];
    
    let r = 1, g = 1, b = 1;
    if (color.startsWith('#')) {
        r = parseInt(color.slice(1, 3), 16) / 255;
        g = parseInt(color.slice(3, 5), 16) / 255;
        b = parseInt(color.slice(5, 7), 16) / 255;
    }
    
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);
    
    const hw = size / 2;
    
    switch (shapeType) {
        case 'line':
        case 'arrow':
        case 'double-arrow':
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 1) return null;
            
            const nx = -dy / len * hw;
            const ny = dx / len * hw;
            
            triangles.push(
                start.x + nx, start.y + ny,
                start.x - nx, start.y - ny,
                end.x - nx, end.y - ny,
                start.x + nx, start.y + ny,
                end.x - nx, end.y - ny,
                end.x + nx, end.y + ny
            );
            break;
            
        case 'rect':
            triangles.push(
                minX, minY,
                maxX, minY,
                maxX, maxY,
                minX, minY,
                maxX, maxY,
                minX, maxY
            );
            break;
            
        case 'circle':
        case 'ellipse':
            const cx = (start.x + end.x) / 2;
            const cy = (start.y + end.y) / 2;
            const rx = Math.abs(end.x - start.x) / 2;
            const ry = Math.abs(end.y - start.y) / 2;
            const segments = 32;
            
            for (let i = 0; i < segments; i++) {
                const a1 = (i / segments) * Math.PI * 2;
                const a2 = ((i + 1) / segments) * Math.PI * 2;
                
                triangles.push(
                    cx, cy,
                    cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry,
                    cx + Math.cos(a2) * rx, cy + Math.sin(a2) * ry
                );
            }
            break;
            
        default:
            return null;
    }
    
    if (triangles.length === 0) return null;
    
    const vertexCount = triangles.length / 2;
    const positionData = new Float32Array(triangles);
    const colorData = new Float32Array(vertexCount * 4);
    
    // 批量填充颜色数据
    for (let i = 0; i < vertexCount; i++) {
        colorData[i * 4] = r;
        colorData[i * 4 + 1] = g;
        colorData[i * 4 + 2] = b;
        colorData[i * 4 + 3] = 1.0;
    }
    
    // 使用缓存的缓冲区
    const positionBuffer = getCachedBuffer('shape_position', positionData.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(positionBuffer, 0, positionData);
    
    const colorBuffer = getCachedBuffer('shape_color', colorData.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(colorBuffer, 0, colorData);
    
    const result = { positionBuffer, colorBuffer, vertexCount };
    
    // 缓存结果
    bufferCache.set(cacheKey, result);
    
    return result;
}

function renderCanvasWebGPU(canvas) {
    if (!device || !context || !pipeline) {
        return false;
    }
    
    // 开始性能监控
    const startTime = performance.now();
    performanceStats.drawCalls = 0;
    performanceStats.verticesDrawn = 0;
    
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    
    // Update canvas size if needed
    const currentSize = context.getCurrentTexture()?.width;
    const targetWidth = Math.floor(width * dpr);
    const targetHeight = Math.floor(height * dpr);
    
    if (!currentSize || currentSize !== targetWidth) {
        context.configure({
            device: device,
            format: canvasFormat,
            alphaMode: 'premultiplied',
            size: {
                width: targetWidth,
                height: targetHeight
            }
        });
    }
    
    const camera = state.getActiveCamera();
    const strokes = state.getActiveStrokes();
    
    const uniformData = new Float32Array([
        width,
        height,
        camera.x,
        camera.y,
        camera.z * dpr,
        0,
        0,
        0
    ]);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    
    const commandEncoder = device.createCommandEncoder();
    
    const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
        }]
    });
    
    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, uniformBindGroup);
    
    // 批处理渲染
    if (!state.hideStrokes) {
        // 收集所有笔触的顶点数据
        const allPositions = [];
        const allColors = [];
        
        strokes.forEach(stroke => {
            let renderData = null;
            
            if (stroke.type === 'pen') {
                renderData = renderStrokeWebGPU(stroke, camera);
            } else if (stroke.type === 'shape') {
                renderData = renderShapeWebGPU(stroke, camera);
            }
            
            if (renderData && renderData.vertexCount > 0) {
                // 这里简化处理，实际应该使用更高效的批处理方法
                // 但为了保持兼容性，暂时使用现有的渲染方式
                renderPass.setVertexBuffer(0, renderData.positionBuffer);
                renderPass.setVertexBuffer(1, renderData.colorBuffer);
                renderPass.draw(renderData.vertexCount);
                
                // 性能统计
                performanceStats.drawCalls++;
                performanceStats.verticesDrawn += renderData.vertexCount;
            }
        });
        
        // 如果有足够的顶点数据，使用批处理
        /*
        if (allPositions.length > 0) {
            const vertexCount = allPositions.length / 2;
            const positionData = new Float32Array(allPositions);
            const colorData = new Float32Array(allColors);
            
            // 确保缓冲区足够大
            if (vertexCount > bufferCapacity) {
                batchBufferSize = Math.max(batchBufferSize, vertexCount * 2);
                createBatchBuffers();
            }
            
            // 写入缓冲区
            device.queue.writeBuffer(positionBuffer, 0, positionData);
            device.queue.writeBuffer(colorBuffer, 0, colorData);
            
            // 一次绘制所有笔触
            renderPass.setVertexBuffer(0, positionBuffer);
            renderPass.setVertexBuffer(1, colorBuffer);
            renderPass.draw(vertexCount);
        }
        */
    }
    
    // 渲染当前正在绘制的笔触
    if (state.isDrawing && state.currentTool === 'pen' && state.currentPoints.length > 0) {
        const previewStroke = {
            points: state.currentPoints,
            color: state.penColor,
            size: state.penSize,
            taper: state.penTaper
        };
        const renderData = renderStrokeWebGPU(previewStroke, camera);
        if (renderData && renderData.vertexCount > 0) {
            renderPass.setVertexBuffer(0, renderData.positionBuffer);
            renderPass.setVertexBuffer(1, renderData.colorBuffer);
            renderPass.draw(renderData.vertexCount);
            
            // 性能统计
            performanceStats.drawCalls++;
            performanceStats.verticesDrawn += renderData.vertexCount;
        }
    }
    
    renderPass.end();
    
    device.queue.submit([commandEncoder.finish()]);
    
    // 结束性能监控
    const endTime = performance.now();
    performanceStats.renderTime = endTime - startTime;
    
    // 计算FPS
    performanceStats.frameCount++;
    if (endTime - performanceStats.lastFpsTime >= 1000) {
        performanceStats.currentFps = performanceStats.frameCount;
        performanceStats.frameCount = 0;
        performanceStats.lastFpsTime = endTime;
        
        // 每秒钟输出一次性能统计
        if (performanceStats.currentFps < 30) {
            console.warn('[WebGPU] Performance warning:', {
                fps: performanceStats.currentFps,
                renderTime: performanceStats.renderTime.toFixed(2),
                drawCalls: performanceStats.drawCalls,
                vertices: performanceStats.verticesDrawn,
                cacheSize: bufferCache.size
            });
        }
    }
    
    return true;
}

function isAvailable() {
    return isInitialized && device !== null;
}

function cleanup() {
    if (device) {
        device.destroy();
        device = null;
    }
    context = null;
    pipeline = null;
    uniformBuffer = null;
    uniformBindGroup = null;
    positionBuffer = null;
    colorBuffer = null;
    
    // 清理缓冲区缓存
    bufferCache.clear();
    
    isInitialized = false;
    initPromise = null;
}

module.exports = {
    initWebGPU,
    renderCanvasWebGPU,
    isAvailable,
    cleanup
};
